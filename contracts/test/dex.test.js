const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { parseUnits, parseEther, MaxUint256, ZeroAddress } = ethers;

const DEADLINE = 99999999999;

async function deployFixture() {
  const [deployer, alice, bob, feeCollector] = await ethers.getSigners();

  const WETH9 = await ethers.getContractFactory("WETH9");
  const weth = await WETH9.deploy();

  const Factory = await ethers.getContractFactory("RhoFactory");
  const factory = await Factory.deploy(deployer.address);

  const Router = await ethers.getContractFactory("RhoRouter");
  const router = await Router.deploy(await factory.getAddress(), await weth.getAddress());

  const Lens = await ethers.getContractFactory("RhoLens");
  const lens = await Lens.deploy(await factory.getAddress());

  const TestToken = await ethers.getContractFactory("TestToken");
  const tokenA = await TestToken.deploy("Token A", "AAA", 18, parseUnits("1000000", 18));
  const tokenB = await TestToken.deploy("Token B", "BBB", 18, parseUnits("1000000", 18));
  const usdc = await TestToken.deploy("USD Coin", "USDC", 6, parseUnits("1000000", 6));

  const routerAddress = await router.getAddress();
  for (const token of [tokenA, tokenB, usdc]) {
    await token.approve(routerAddress, MaxUint256);
    for (const user of [alice, bob]) {
      await token.mint(user.address, parseUnits("100000", await token.decimals()));
      await token.connect(user).approve(routerAddress, MaxUint256);
    }
  }

  return { deployer, alice, bob, feeCollector, weth, factory, router, lens, tokenA, tokenB, usdc };
}

async function seededFixture() {
  const ctx = await deployFixture();
  const { router, deployer, tokenA, tokenB, usdc } = ctx;

  // A/B pool at 1:2, A/USDC pool at 1 A = 10 USDC, and a WETH/A pool.
  await router.addLiquidity(
    await tokenA.getAddress(),
    await tokenB.getAddress(),
    parseUnits("10000", 18),
    parseUnits("20000", 18),
    0,
    0,
    deployer.address,
    DEADLINE,
  );
  await router.addLiquidity(
    await tokenA.getAddress(),
    await usdc.getAddress(),
    parseUnits("10000", 18),
    parseUnits("100000", 6),
    0,
    0,
    deployer.address,
    DEADLINE,
  );
  await router.addLiquidityETH(
    await tokenA.getAddress(),
    parseUnits("5000", 18),
    0,
    0,
    deployer.address,
    DEADLINE,
    { value: parseEther("10") },
  );

  return ctx;
}

describe("RhoFactory", () => {
  it("creates a pair and registers it in both directions", async () => {
    const { factory, tokenA, tokenB } = await loadFixture(deployFixture);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();

    await expect(factory.createPair(a, b)).to.emit(factory, "PairCreated");

    const pair = await factory.getPair(a, b);
    expect(pair).to.not.equal(ZeroAddress);
    expect(await factory.getPair(b, a)).to.equal(pair);
    expect(await factory.allPairsLength()).to.equal(1n);
    expect(await factory.allPairs(0)).to.equal(pair);
  });

  it("sorts token0 below token1 regardless of argument order", async () => {
    const { factory, tokenA, tokenB } = await loadFixture(deployFixture);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();
    await factory.createPair(b, a);

    const pair = await ethers.getContractAt("RhoPair", await factory.getPair(a, b));
    const [expected0, expected1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    expect(await pair.token0()).to.equal(expected0);
    expect(await pair.token1()).to.equal(expected1);
  });

  it("rejects duplicate, identical and zero-address pairs", async () => {
    const { factory, tokenA, tokenB } = await loadFixture(deployFixture);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();

    await factory.createPair(a, b);
    await expect(factory.createPair(a, b)).to.be.revertedWith("Rho: PAIR_EXISTS");
    await expect(factory.createPair(a, a)).to.be.revertedWith("Rho: IDENTICAL_ADDRESSES");
    await expect(factory.createPair(a, ZeroAddress)).to.be.revertedWith("Rho: ZERO_ADDRESS");
  });

  it("gates fee configuration behind feeToSetter", async () => {
    const { factory, alice, feeCollector } = await loadFixture(deployFixture);
    await expect(factory.connect(alice).setFeeTo(alice.address)).to.be.revertedWith("Rho: FORBIDDEN");

    await factory.setFeeTo(feeCollector.address);
    expect(await factory.feeTo()).to.equal(feeCollector.address);

    await factory.setFeeToSetter(alice.address);
    expect(await factory.feeToSetter()).to.equal(alice.address);
    await expect(factory.setFeeTo(ZeroAddress)).to.be.revertedWith("Rho: FORBIDDEN");
  });
});

describe("RhoPair", () => {
  it("locks MINIMUM_LIQUIDITY on the first mint", async () => {
    const { router, factory, deployer, tokenA, tokenB } = await loadFixture(deployFixture);
    await router.addLiquidity(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      parseUnits("100", 18),
      parseUnits("400", 18),
      0,
      0,
      deployer.address,
      DEADLINE,
    );

    const pair = await ethers.getContractAt(
      "RhoPair",
      await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress()),
    );

    // sqrt(100e18 * 400e18) = 200e18, minus the 1000 wei locked forever.
    const minimum = await pair.MINIMUM_LIQUIDITY();
    expect(await pair.totalSupply()).to.equal(parseUnits("200", 18));
    expect(await pair.balanceOf(deployer.address)).to.equal(parseUnits("200", 18) - minimum);
    expect(await pair.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(minimum);
  });

  it("keeps k from decreasing across a swap", async () => {
    const { router, factory, alice, tokenA, tokenB } = await loadFixture(seededFixture);
    const pair = await ethers.getContractAt(
      "RhoPair",
      await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress()),
    );

    const [r0Before, r1Before] = await pair.getReserves();
    const kBefore = r0Before * r1Before;

    await router
      .connect(alice)
      .swapExactTokensForTokens(
        parseUnits("500", 18),
        0,
        [await tokenA.getAddress(), await tokenB.getAddress()],
        alice.address,
        DEADLINE,
      );

    const [r0After, r1After] = await pair.getReserves();
    expect(r0After * r1After).to.be.greaterThan(kBefore);
  });

  it("accumulates TWAP prices over time", async () => {
    const { factory, tokenA, tokenB } = await loadFixture(seededFixture);
    const pair = await ethers.getContractAt(
      "RhoPair",
      await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress()),
    );

    expect(await pair.price0CumulativeLast()).to.equal(0n);
    await ethers.provider.send("evm_increaseTime", [3600]);
    await pair.sync();

    expect(await pair.price0CumulativeLast()).to.be.greaterThan(0n);
    expect(await pair.price1CumulativeLast()).to.be.greaterThan(0n);
  });

  it("mints the protocol fee to feeTo when enabled", async () => {
    const { router, factory, deployer, alice, feeCollector, tokenA, tokenB } = await loadFixture(seededFixture);
    await factory.setFeeTo(feeCollector.address);

    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();
    const pair = await ethers.getContractAt("RhoPair", await factory.getPair(a, b));

    // kLast is only recorded on the first liquidity event after feeTo is enabled,
    // so fees accrue from here rather than from the pool's creation.
    await router.addLiquidity(a, b, parseUnits("100", 18), parseUnits("200", 18), 0, 0, deployer.address, DEADLINE);
    expect(await pair.kLast()).to.be.greaterThan(0n);

    // Generate fees, then trigger another liquidity event so _mintFee runs.
    for (let i = 0; i < 5; i++) {
      await router.connect(alice).swapExactTokensForTokens(parseUnits("1000", 18), 0, [a, b], alice.address, DEADLINE);
      await router.connect(alice).swapExactTokensForTokens(parseUnits("2000", 18), 0, [b, a], alice.address, DEADLINE);
    }

    expect(await pair.balanceOf(feeCollector.address)).to.equal(0n);

    await pair.approve(await router.getAddress(), MaxUint256);
    await router.removeLiquidity(a, b, parseUnits("1", 18), 0, 0, deployer.address, DEADLINE);

    expect(await pair.balanceOf(feeCollector.address)).to.be.greaterThan(0n);
  });

  it("blocks reentrancy through the lock modifier", async () => {
    const { factory, tokenA, tokenB } = await loadFixture(seededFixture);
    const pair = await ethers.getContractAt(
      "RhoPair",
      await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress()),
    );

    const Attacker = await ethers.getContractFactory("ReentrantCallee");
    const attacker = await Attacker.deploy();

    await expect(
      pair.swap(parseUnits("1", 18), 0, await attacker.getAddress(), "0x01"),
    ).to.be.revertedWith("Rho: LOCKED");
  });
});

describe("RhoRouter - liquidity", () => {
  it("returns the ratio-matched amounts and refunds the surplus", async () => {
    const { router, deployer, tokenA, tokenB } = await loadFixture(seededFixture);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();

    // Pool is 1:2, so offering 100 A + 1000 B should only consume 200 B.
    const before = await tokenB.balanceOf(deployer.address);
    await router.addLiquidity(a, b, parseUnits("100", 18), parseUnits("1000", 18), 0, 0, deployer.address, DEADLINE);
    const spentB = before - (await tokenB.balanceOf(deployer.address));

    expect(spentB).to.equal(parseUnits("200", 18));
  });

  it("enforces the minimum amounts", async () => {
    const { router, deployer, tokenA, tokenB } = await loadFixture(seededFixture);
    await expect(
      router.addLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        parseUnits("100", 18),
        parseUnits("1000", 18),
        0,
        parseUnits("999", 18),
        deployer.address,
        DEADLINE,
      ),
    ).to.be.revertedWith("RhoRouter: INSUFFICIENT_B_AMOUNT");
  });

  it("round-trips liquidity back to the underlying tokens", async () => {
    const { router, factory, deployer, tokenA, tokenB } = await loadFixture(seededFixture);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();
    const pair = await ethers.getContractAt("RhoPair", await factory.getPair(a, b));

    const liquidity = await pair.balanceOf(deployer.address);
    await pair.approve(await router.getAddress(), MaxUint256);

    const beforeA = await tokenA.balanceOf(deployer.address);
    const beforeB = await tokenB.balanceOf(deployer.address);
    await router.removeLiquidity(a, b, liquidity, 0, 0, deployer.address, DEADLINE);

    expect(await tokenA.balanceOf(deployer.address)).to.be.greaterThan(beforeA);
    expect(await tokenB.balanceOf(deployer.address)).to.be.greaterThan(beforeB);
    expect(await pair.balanceOf(deployer.address)).to.equal(0n);
  });

  it("adds and removes ETH liquidity, returning native currency", async () => {
    const { router, factory, deployer, weth, tokenA } = await loadFixture(seededFixture);
    const a = await tokenA.getAddress();
    const pair = await ethers.getContractAt("RhoPair", await factory.getPair(a, await weth.getAddress()));

    const liquidity = await pair.balanceOf(deployer.address);
    await pair.approve(await router.getAddress(), MaxUint256);

    const beforeEth = await ethers.provider.getBalance(deployer.address);
    const tx = await router.removeLiquidityETH(a, liquidity, 0, 0, deployer.address, DEADLINE);
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;

    const afterEth = await ethers.provider.getBalance(deployer.address);
    expect(afterEth + gasCost).to.be.greaterThan(beforeEth);
  });

  it("supports removing liquidity with an EIP-2612 permit", async () => {
    const { router, factory, deployer, tokenA, tokenB } = await loadFixture(seededFixture);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();
    const pair = await ethers.getContractAt("RhoPair", await factory.getPair(a, b));
    const routerAddress = await router.getAddress();

    const liquidity = parseUnits("10", 18);
    const nonce = await pair.nonces(deployer.address);
    const chainId = Number((await ethers.provider.getNetwork()).chainId);

    const signature = await deployer.signTypedData(
      { name: "Rho LP Token", version: "1", chainId, verifyingContract: await pair.getAddress() },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { owner: deployer.address, spender: routerAddress, value: liquidity, nonce, deadline: DEADLINE },
    );
    const { v, r, s } = ethers.Signature.from(signature);

    await expect(
      router.removeLiquidityWithPermit(a, b, liquidity, 0, 0, deployer.address, DEADLINE, false, v, r, s),
    ).to.not.be.reverted;
  });
});

describe("RhoRouter - swaps", () => {
  it("matches the quoted output exactly", async () => {
    const { router, alice, tokenA, tokenB } = await loadFixture(seededFixture);
    const path = [await tokenA.getAddress(), await tokenB.getAddress()];
    const amountIn = parseUnits("100", 18);

    const quoted = await router.getAmountsOut(amountIn, path);
    const before = await tokenB.balanceOf(alice.address);
    await router.connect(alice).swapExactTokensForTokens(amountIn, quoted[1], path, alice.address, DEADLINE);

    expect((await tokenB.balanceOf(alice.address)) - before).to.equal(quoted[1]);
  });

  it("charges the 0.30% fee", async () => {
    const { router } = await loadFixture(seededFixture);
    // 1000 in against 1e6 / 1e6 reserves: out = 997 * 1e6 / (1e6 * 1000 + 997e3) ~ 996
    const out = await router.getAmountOut(parseUnits("1000", 18), parseUnits("1000000", 18), parseUnits("1000000", 18));
    const zeroFee = (parseUnits("1000", 18) * parseUnits("1000000", 18)) / (parseUnits("1000000", 18) + parseUnits("1000", 18));
    expect(out).to.be.lessThan(zeroFee);
    expect(out).to.be.greaterThan((zeroFee * 996n) / 1000n);
  });

  it("reverts when the output is below the slippage floor", async () => {
    const { router, alice, tokenA, tokenB } = await loadFixture(seededFixture);
    const path = [await tokenA.getAddress(), await tokenB.getAddress()];
    const amountIn = parseUnits("100", 18);
    const quoted = await router.getAmountsOut(amountIn, path);

    await expect(
      router.connect(alice).swapExactTokensForTokens(amountIn, quoted[1] + 1n, path, alice.address, DEADLINE),
    ).to.be.revertedWith("RhoRouter: INSUFFICIENT_OUTPUT_AMOUNT");
  });

  it("reverts after the deadline", async () => {
    const { router, alice, tokenA, tokenB } = await loadFixture(seededFixture);
    const path = [await tokenA.getAddress(), await tokenB.getAddress()];
    const past = (await ethers.provider.getBlock("latest")).timestamp - 1;

    await expect(
      router.connect(alice).swapExactTokensForTokens(parseUnits("1", 18), 0, path, alice.address, past),
    ).to.be.revertedWith("RhoRouter: EXPIRED");
  });

  it("swaps for an exact output and caps the input", async () => {
    const { router, alice, tokenA, tokenB } = await loadFixture(seededFixture);
    const path = [await tokenA.getAddress(), await tokenB.getAddress()];
    const amountOut = parseUnits("200", 18);
    const quoted = await router.getAmountsIn(amountOut, path);

    const beforeA = await tokenA.balanceOf(alice.address);
    const beforeB = await tokenB.balanceOf(alice.address);
    await router.connect(alice).swapTokensForExactTokens(amountOut, quoted[0], path, alice.address, DEADLINE);

    expect((await tokenB.balanceOf(alice.address)) - beforeB).to.equal(amountOut);
    expect(beforeA - (await tokenA.balanceOf(alice.address))).to.equal(quoted[0]);

    await expect(
      router.connect(alice).swapTokensForExactTokens(amountOut, quoted[0] - quoted[0], path, alice.address, DEADLINE),
    ).to.be.revertedWith("RhoRouter: EXCESSIVE_INPUT_AMOUNT");
  });

  it("routes multi-hop through an intermediate token", async () => {
    const { router, alice, tokenA, tokenB, usdc } = await loadFixture(seededFixture);
    const path = [await tokenB.getAddress(), await tokenA.getAddress(), await usdc.getAddress()];

    const quoted = await router.getAmountsOut(parseUnits("1000", 18), path);
    expect(quoted.length).to.equal(3);

    const before = await usdc.balanceOf(alice.address);
    await router.connect(alice).swapExactTokensForTokens(parseUnits("1000", 18), 0, path, alice.address, DEADLINE);
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(quoted[2]);
  });

  it("handles differing decimals (18 -> 6)", async () => {
    const { router, alice, tokenA, usdc } = await loadFixture(seededFixture);
    const path = [await tokenA.getAddress(), await usdc.getAddress()];

    const before = await usdc.balanceOf(alice.address);
    await router.connect(alice).swapExactTokensForTokens(parseUnits("100", 18), 0, path, alice.address, DEADLINE);
    const received = (await usdc.balanceOf(alice.address)) - before;

    // Pool is 10000 A : 100000 USDC, so ~10 USDC per A minus fee and impact.
    expect(received).to.be.greaterThan(parseUnits("950", 6));
    expect(received).to.be.lessThan(parseUnits("1000", 6));
  });

  it("swaps exact ETH for tokens", async () => {
    const { router, weth, alice, tokenA } = await loadFixture(seededFixture);
    const path = [await weth.getAddress(), await tokenA.getAddress()];

    const quoted = await router.getAmountsOut(parseEther("1"), path);
    const before = await tokenA.balanceOf(alice.address);
    await router.connect(alice).swapExactETHForTokens(quoted[1], path, alice.address, DEADLINE, {
      value: parseEther("1"),
    });

    expect((await tokenA.balanceOf(alice.address)) - before).to.equal(quoted[1]);
  });

  it("swaps exact tokens for ETH", async () => {
    const { router, weth, alice, tokenA } = await loadFixture(seededFixture);
    const path = [await tokenA.getAddress(), await weth.getAddress()];

    const before = await ethers.provider.getBalance(alice.address);
    const tx = await router
      .connect(alice)
      .swapExactTokensForETH(parseUnits("100", 18), 0, path, alice.address, DEADLINE);
    const receipt = await tx.wait();

    const after = await ethers.provider.getBalance(alice.address);
    expect(after + receipt.gasUsed * receipt.gasPrice).to.be.greaterThan(before);
  });

  it("refunds unspent ETH on swapETHForExactTokens", async () => {
    const { router, weth, alice, tokenA } = await loadFixture(seededFixture);
    const path = [await weth.getAddress(), await tokenA.getAddress()];
    const amountOut = parseUnits("100", 18);
    const quoted = await router.getAmountsIn(amountOut, path);

    const before = await ethers.provider.getBalance(alice.address);
    const tx = await router.connect(alice).swapETHForExactTokens(amountOut, path, alice.address, DEADLINE, {
      value: parseEther("5"),
    });
    const receipt = await tx.wait();
    const after = await ethers.provider.getBalance(alice.address);

    // Only the quoted input plus gas should leave the account.
    expect(before - after - receipt.gasUsed * receipt.gasPrice).to.equal(quoted[0]);
  });

  it("rejects an ETH path that does not start at WETH", async () => {
    const { router, alice, tokenA, tokenB } = await loadFixture(seededFixture);
    await expect(
      router
        .connect(alice)
        .swapExactETHForTokens(0, [await tokenA.getAddress(), await tokenB.getAddress()], alice.address, DEADLINE, {
          value: parseEther("1"),
        }),
    ).to.be.revertedWith("RhoRouter: INVALID_PATH");
  });

  it("rejects direct ETH transfers to the router", async () => {
    const { router, alice } = await loadFixture(seededFixture);
    await expect(
      alice.sendTransaction({ to: await router.getAddress(), value: parseEther("1") }),
    ).to.be.revertedWith("RhoRouter: DIRECT_TRANSFER");
  });

  it("reverts on an unknown pair instead of quoting zero", async () => {
    const { router, tokenB, usdc } = await loadFixture(deployFixture);
    await expect(
      router.getAmountsOut(parseUnits("1", 18), [await tokenB.getAddress(), await usdc.getAddress()]),
    ).to.be.revertedWith("RhoLibrary: PAIR_NOT_FOUND");
  });
});

describe("RhoLens", () => {
  it("reports pool state and the user's LP position", async () => {
    const { lens, factory, deployer, tokenA, tokenB } = await loadFixture(seededFixture);
    const pools = await lens.getPools(0, 10, deployer.address);

    expect(pools.length).to.equal(3);

    const pairAddress = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    const pool = pools.find((p) => p.pair === pairAddress);
    expect(pool.lpTotalSupply).to.be.greaterThan(0n);
    expect(pool.userLiquidity).to.be.greaterThan(0n);
    expect([pool.symbol0, pool.symbol1].sort()).to.deep.equal(["AAA", "BBB"]);

    // Underlying supplies and the creation timestamp drive the FDV and age columns.
    expect(pool.supply0).to.be.greaterThan(0n);
    expect(pool.supply1).to.be.greaterThan(0n);
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    expect(pool.createdAt).to.be.greaterThan(0n);
    expect(pool.createdAt).to.be.lessThanOrEqual(now);
  });

  it("pages past the end without reverting", async () => {
    const { lens, deployer } = await loadFixture(seededFixture);
    expect((await lens.getPools(0, 2, deployer.address)).length).to.equal(2);
    expect((await lens.getPools(2, 10, deployer.address)).length).to.equal(1);
    expect((await lens.getPools(99, 10, deployer.address)).length).to.equal(0);
  });

  it("describes pools from another factory, so the explorer can index the chain", async () => {
    const { lens, deployer, tokenA, tokenB } = await loadFixture(seededFixture);

    // Stand in for a different DEX deployed on the same chain.
    const OtherFactory = await ethers.getContractFactory("RhoFactory");
    const other = await OtherFactory.deploy(deployer.address);
    await other.createPair(await tokenA.getAddress(), await tokenB.getAddress());
    const foreignPair = await other.getPair(await tokenA.getAddress(), await tokenB.getAddress());

    const [pool] = await lens.getPoolsByAddress([foreignPair], deployer.address);
    expect(pool.pair).to.equal(foreignPair);
    expect([pool.symbol0, pool.symbol1].sort()).to.deep.equal(["AAA", "BBB"]);
    expect(pool.decimals0).to.equal(18);
  });

  it("zeroes entries that are not pools instead of reverting the batch", async () => {
    const { lens, factory, deployer, tokenA, tokenB } = await loadFixture(seededFixture);
    const realPair = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    const notAPair = await tokenA.getAddress();

    const pools = await lens.getPoolsByAddress([realPair, notAPair], deployer.address);
    expect(pools.length).to.equal(2);
    expect(pools[0].symbol0).to.not.equal("");
    expect(pools[1].pair).to.equal(notAPair);
    expect(pools[1].token0).to.equal(ZeroAddress);
  });

  it("batches token metadata, balances and allowances", async () => {
    const { lens, router, deployer, tokenA, usdc } = await loadFixture(seededFixture);
    const infos = await lens.getTokens(
      [await tokenA.getAddress(), await usdc.getAddress()],
      deployer.address,
      await router.getAddress(),
    );

    expect(infos[0].symbol).to.equal("AAA");
    expect(infos[0].decimals).to.equal(18);
    expect(infos[1].symbol).to.equal("USDC");
    expect(infos[1].decimals).to.equal(6);
    expect(infos[0].allowance).to.equal(MaxUint256);
  });
});
