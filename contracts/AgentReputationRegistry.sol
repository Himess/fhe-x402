// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AgentReputationRegistry
 * @notice ERC-8004 Reputation Registry — on-chain feedback for AI agents.
 * @dev Anyone can give scored feedback with tags and proof-of-payment.
 */
contract AgentReputationRegistry {
    struct Feedback {
        address reviewer;
        uint8 score;
        bytes32[] tags;
        uint256 timestamp;
    }

    struct Summary {
        uint256 totalFeedback;
        uint256 totalScore;
        uint256 lastUpdated;
    }

    mapping(uint256 => Feedback[]) public feedbackList;
    mapping(uint256 => Summary) public summaries;

    event FeedbackGiven(uint256 indexed agentId, address indexed reviewer, uint8 score);

    /**
     * @notice Submit feedback for an agent.
     * @param agentId The agent's identity ID.
     * @param score Rating 0-255 (uint8).
     * @param tags Categorization tags (bytes32 encoded).
     * @param proofOfPayment Encoded proof that reviewer paid the agent.
     */
    function giveFeedback(
        uint256 agentId,
        uint8 score,
        bytes32[] calldata tags,
        bytes calldata proofOfPayment
    ) external {
        require(agentId > 0, "Invalid agent ID");
        require(proofOfPayment.length > 0, "Proof required");

        feedbackList[agentId].push(Feedback({
            reviewer: msg.sender,
            score: score,
            tags: tags,
            timestamp: block.timestamp
        }));

        Summary storage s = summaries[agentId];
        s.totalFeedback++;
        s.totalScore += score;
        s.lastUpdated = block.timestamp;

        emit FeedbackGiven(agentId, msg.sender, score);
    }

    /**
     * @notice Get reputation summary for an agent.
     */
    function getSummary(uint256 agentId) external view returns (
        uint256 totalFeedback,
        uint256 averageScore,
        uint256 lastUpdated
    ) {
        Summary storage s = summaries[agentId];
        uint256 avg = s.totalFeedback > 0 ? s.totalScore / s.totalFeedback : 0;
        return (s.totalFeedback, avg, s.lastUpdated);
    }

    /**
     * @notice Get individual feedback entry.
     */
    function getFeedback(uint256 agentId, uint256 index) external view returns (
        address reviewer,
        uint8 score,
        bytes32[] memory tags,
        uint256 timestamp
    ) {
        require(index < feedbackList[agentId].length, "Index out of bounds");
        Feedback storage f = feedbackList[agentId][index];
        return (f.reviewer, f.score, f.tags, f.timestamp);
    }

    /**
     * @notice Get total feedback count for an agent.
     */
    function feedbackCount(uint256 agentId) external view returns (uint256) {
        return feedbackList[agentId].length;
    }
}
