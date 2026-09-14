// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RhoPair.sol";

/// @title RhoFactory
/// @notice Deploys and registers one canonical pool per token pair.
contract RhoFactory {
    address public feeTo;
    address public feeToSetter;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength);

    constructor(address _feeToSetter) {
        require(_feeToSetter != address(0), "Rho: ZERO_FEE_SETTER");
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @dev The creation code hash, needed by off-chain code that predicts pair addresses.
    function pairCodeHash() external pure returns (bytes32) {
        return keccak256(type(RhoPair).creationCode);
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "Rho: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "Rho: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "Rho: PAIR_EXISTS");

        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        pair = address(new RhoPair{salt: salt}());
        RhoPair(pair).initialize(token0, token1);

        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate both directions
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external {
        require(msg.sender == feeToSetter, "Rho: FORBIDDEN");
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external {
        require(msg.sender == feeToSetter, "Rho: FORBIDDEN");
        require(_feeToSetter != address(0), "Rho: ZERO_FEE_SETTER");
        feeToSetter = _feeToSetter;
    }
}
