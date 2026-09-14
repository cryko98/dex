// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IRhoCallee.sol";
import "../interfaces/IRhoPair.sol";

/// @notice Test-only callee that re-enters the pair from inside the flash-swap callback.
contract ReentrantCallee is IRhoCallee {
    function rhoCall(address, uint256, uint256, bytes calldata) external override {
        // msg.sender is the pair mid-swap; any locked entry point must reject this.
        IRhoPair(msg.sender).sync();
    }
}
