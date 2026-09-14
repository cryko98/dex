// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Binary fixed point number, range [0, 2**112 - 1], resolution 1 / 2**112.
library UQ112x112 {
    uint224 constant Q112 = 2 ** 112;

    function encode(uint112 y) internal pure returns (uint224 z) {
        unchecked {
            z = uint224(y) * Q112; // never overflows
        }
    }

    function uqdiv(uint224 x, uint112 y) internal pure returns (uint224 z) {
        unchecked {
            z = x / uint224(y);
        }
    }
}
