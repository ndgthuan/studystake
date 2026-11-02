// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IStudyBadge
/// @notice Interface used by StudyStakeManager to record challenge results on the badge.
interface IStudyBadge {
    /// @notice Records the outcome of a challenge for `account`. Mints the badge on first completion.
    /// @param account Participant address.
    /// @param completed True if the participant completed the challenge.
    function record_result(address account, bool completed) external;
}
