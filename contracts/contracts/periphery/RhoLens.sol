// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IRhoFactory.sol";
import "../interfaces/IRhoPair.sol";
import "../interfaces/IERC20.sol";

/// @title RhoLens
/// @notice Read-only aggregation so the UI can load every pool in a couple of calls.
/// @dev Every optional read is a staticcall with a fallback, so this also describes
///      pools from other Uniswap-V2-style factories on the same chain. That is what
///      lets the explorer index the whole chain rather than just Rho's own pairs.
contract RhoLens {
    struct PoolInfo {
        address pair;
        address token0;
        address token1;
        string symbol0;
        string symbol1;
        uint8 decimals0;
        uint8 decimals1;
        uint112 reserve0;
        uint112 reserve1;
        /// @dev Supply of the LP token itself.
        uint256 lpTotalSupply;
        uint256 userLiquidity;
        /// @dev Supplies of the underlying tokens, for fully-diluted valuations.
        uint256 supply0;
        uint256 supply1;
        /// @dev When the pool was created, for the age column.
        uint256 createdAt;
    }

    struct TokenInfo {
        address token;
        string name;
        string symbol;
        uint8 decimals;
        uint256 balance;
        uint256 allowance;
    }

    address public immutable factory;

    constructor(address _factory) {
        require(_factory != address(0), "RhoLens: ZERO_ADDRESS");
        factory = _factory;
    }

    /// @notice Returns a page of pools, newest-last, with `user`'s LP balance filled in.
    function getPools(uint256 offset, uint256 limit, address user) external view returns (PoolInfo[] memory pools) {
        uint256 total = IRhoFactory(factory).allPairsLength();
        if (offset >= total) return new PoolInfo[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;

        pools = new PoolInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            pools[i - offset] = getPool(IRhoFactory(factory).allPairs(i), user);
        }
    }

    function getPool(address pair, address user) public view returns (PoolInfo memory info) {
        IRhoPair p = IRhoPair(pair);
        info.pair = pair;
        info.token0 = p.token0();
        info.token1 = p.token1();
        info.symbol0 = _symbol(info.token0);
        info.symbol1 = _symbol(info.token1);
        info.decimals0 = _decimals(info.token0);
        info.decimals1 = _decimals(info.token1);
        (info.reserve0, info.reserve1,) = p.getReserves();
        info.lpTotalSupply = p.totalSupply();
        info.userLiquidity = user == address(0) ? 0 : p.balanceOf(user);
        info.supply0 = _totalSupply(info.token0);
        info.supply1 = _totalSupply(info.token1);
        info.createdAt = _createdAt(pair);
    }

    /// @notice Describes any list of pairs, including ones from other factories.
    /// @dev Entries that are not V2-style pools come back zeroed rather than reverting.
    function getPoolsByAddress(address[] calldata pairs, address user)
        external
        view
        returns (PoolInfo[] memory pools)
    {
        pools = new PoolInfo[](pairs.length);
        for (uint256 i; i < pairs.length; i++) {
            (bool ok, bytes memory data) =
                address(this).staticcall(abi.encodeWithSelector(this.getPool.selector, pairs[i], user));
            if (ok && data.length > 0) {
                pools[i] = abi.decode(data, (PoolInfo));
            } else {
                pools[i].pair = pairs[i];
            }
        }
    }

    /// @notice Metadata plus balance/allowance for a list of tokens in one call.
    function getTokens(address[] calldata tokens, address user, address spender)
        external
        view
        returns (TokenInfo[] memory infos)
    {
        infos = new TokenInfo[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            infos[i] = TokenInfo({
                token: t,
                name: _name(t),
                symbol: _symbol(t),
                decimals: IERC20(t).decimals(),
                balance: user == address(0) ? 0 : IERC20(t).balanceOf(user),
                allowance: user == address(0) ? 0 : IERC20(t).allowance(user, spender)
            });
        }
    }

    /// @dev Pools from other factories have no createdAt; report 0 rather than reverting.
    function _createdAt(address pair) internal view returns (uint256) {
        (bool ok, bytes memory data) = pair.staticcall(abi.encodeWithSelector(IRhoPair.createdAt.selector));
        return ok && data.length >= 32 ? abi.decode(data, (uint256)) : 0;
    }

    function _decimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC20.decimals.selector));
        if (!ok || data.length < 32) return 18;
        uint256 value = abi.decode(data, (uint256));
        return value <= 77 ? uint8(value) : 18;
    }

    function _totalSupply(address token) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC20.totalSupply.selector));
        return ok && data.length >= 32 ? abi.decode(data, (uint256)) : 0;
    }

    /// @dev Tolerates tokens whose symbol()/name() return bytes32 or revert.
    function _symbol(address token) internal view returns (string memory) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC20.symbol.selector));
        return _decodeString(ok, data, "???");
    }

    function _name(address token) internal view returns (string memory) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC20.name.selector));
        return _decodeString(ok, data, "Unknown");
    }

    function _decodeString(bool ok, bytes memory data, string memory fallbackValue)
        private
        pure
        returns (string memory)
    {
        if (!ok || data.length == 0) return fallbackValue;
        if (data.length == 32) {
            // bytes32-style token (pre-standard ERC20): trim the null padding.
            bytes32 raw = abi.decode(data, (bytes32));
            uint256 len;
            while (len < 32 && raw[len] != 0) len++;
            bytes memory trimmed = new bytes(len);
            for (uint256 i; i < len; i++) {
                trimmed[i] = raw[i];
            }
            return len == 0 ? fallbackValue : string(trimmed);
        }
        return abi.decode(data, (string));
    }
}
