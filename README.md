# Chaperone

**Give an AI agent money without giving it the keys.**

Chaperone is a policy wallet on NEAR for AI agents. The agent holds only a function-call key scoped to the vault contract. Every spend passes a counterparty risk check (allow, warn, block) and owner-set limits: daily budget, per-transaction cap, recipient and token allowlists, and a timelock for new recipients. Anything in the warn band waits for the owner's approval.

## Status

In active development. Setup instructions, architecture and a demo will land here as the build progresses.

## License

MIT
