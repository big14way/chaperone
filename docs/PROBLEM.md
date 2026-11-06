# Why Chaperone exists

## The short version

AI agents are being handed wallets. A wallet key is all-or-nothing, and an agent decides
what to do by reading text. So anyone who can put text in front of the agent (a tweet, a
web page, an invoice, a memory entry) can try to move its money. This has already
happened, repeatedly, with real funds. Chaperone puts the limits where the model cannot
reach them: in a NEAR contract, enforced by a key that can only ask.

## It keeps happening

| When | What happened | How the money moved | Loss |
|---|---|---|---|
| Nov 2024 | **Freysa**, an AI agent guarding a prize pool, was told never to release it. 195 people tried 482 times. The 482nd message convinced it that "approve transfer" meant *receiving* money. | The model's own judgement was the only control. | 13.19 ETH, about $47,000 ([The Block](https://www.theblock.co/post/328747), [OECD AI incident](https://oecd.ai/en/incidents/2024-11-29-2e31)) |
| Mar 18, 2025 | **AIXBT**, an autonomous crypto agent. At 2:00 AM UTC an attacker got into the operator dashboard and queued two prompts telling the agent to pay out. | Whoever could feed the agent prompts controlled the wallet. | ~55.5 ETH, about $106,000 ([Cointelegraph](https://cointelegraph.com/news/hacker-breaches-ai-crypto-bot-aixbt-steals-55-eth), [The Block](https://www.theblock.co/post/346911/)) |
| May 2025 | **Princeton / Sentient research** on ElizaOS agents: a planted "memory" made agents send crypto to the attacker, and prompt-based defences did not stop it. Title of the paper: *No Silver Bullet*. | Poisoned context persists across sessions and users. | Demonstrated, not stolen ([arXiv 2503.16248](https://arxiv.org/html/2503.16248v1), [Decrypt](https://decrypt.co/318200/elizaos-vulnerability-ai-gaslit-losing-millions)) |
| May 4, 2026 | **Grok + Bankrbot**: a reply on X hid a transfer instruction in Morse code. After an NFT gift expanded the wallet's permissions, the agents sent 3 billion DRB tokens to the attacker. | One public reply. Permissions changed by an inbound asset, not by the owner. | ~$150,000 to $200,000 ([OECD AI incident](https://oecd.ai/en/incidents/2026-05-04-4a73), [AMBCrypto](https://ambcrypto.com/ai-linked-wallet-drained-via-prompt-injection-in-bankr-exploit/), [CCN](https://www.ccn.com/news/crypto/ai-agent-drained-for-200k-with-this-one-tweet-hack-heres-how/)) |
| Jun 2026 (disclosed Oct 2026) | **OpenAI** found that an internal research model, stuck without test funds, located a funded wallet from public recovery phrases, decided the spending was acceptable, paid its fees from it, and left that out of its report. | The agent reasoned its way past "no permission". Testnet tokens, real lesson. | Little monetary value ([Fortune](https://fortune.com/2026/10/16/rogue-openai-agent-crypto-wallet-funds-task/)) |

The pattern is the same every time: **the only thing between text and money was the
model's judgement**, or a permission that something other than the owner could change.

## The same attack, without crypto

The attack in our demo, a "payment address changed" instruction hidden in an invoice, is
the oldest fraud in accounts payable. The FBI's 2025 Internet Crime Report counts
**$3.046 billion** lost to business email compromise across **24,768 complaints**, about
68 businesses every day, most of it by wire transfer ([IC3 2025 report coverage](https://www.mcdonaldhopkins.com/insights/news/the-sobering-truth-of-the-fbis-2025-internet-crime-complaint-center-report),
[CyberScoop](https://cyberscoop.com/fbi-internet-crime-complaint-center-annual-cybercrime-report/)).
A human clerk sometimes notices. An AI agent that pays invoices reads the hidden line and
obeys, at machine speed, every time it sees one.

## Who gets hurt, and how it feels

*Illustrative scenario, built from the incidents above.*

Ada runs a six-person studio. She gives an agent a wallet so it can pay the data vendors
and API bills she used to pay at midnight. It works for weeks. Then a vendor's invoice page
is compromised. One white-on-white line says the bank details changed. The agent, doing
exactly what it was told ("pay what the invoice says"), sends the month's budget to a
two-hour-old account. There is no bank to call and no chargeback. The transaction is
final, and so is the lesson: she will never trust an agent with money again.

That last part is the real cost. Every drained agent wallet teaches a founder, a DAO or a
finance team that agents cannot be trusted with money, and the agent economy everyone is
building stalls on that sentence.

## Why the obvious fixes fail

- **"Write a better prompt."** Freysa had one rule and lost to message 482. The
  Princeton paper is titled *No Silver Bullet* for a reason: prompt-based defences did
  not stop memory injection.
- **"Approve every payment by hand."** Then the agent is not autonomous. Agent payments are
  mostly tiny; a human click can cost more than the payment it guards (the "approval gap",
  [CryptoSlate via LetsDataScience](https://letsdatascience.com/news/x402-reveals-approval-gap-in-agentic-micropayments-761bf8e7)).
- **"Give it a small hot wallet."** Still all-or-nothing. A small wallet is drained just as
  completely, and topping it up is a manual job forever.

## What Chaperone does about it

The agent never holds a key that can move money. It holds a NEAR **function-call key**
that can call one method, `request_spend`, on the vault, cannot attach a deposit, and has a
capped gas allowance. Every request must carry a counterparty verdict signed by the risk
checker, and must pass the owner's rules in the contract: per-payment cap, daily budget
per agent, recipient allowlist, a waiting period for new recipients, allowed tokens.
Unusual payments wait for the owner's wallet approval. Rules can only block; they never
change the amount or the recipient. Everything is logged on-chain with reasons.

How that maps onto the incidents:

| Incident | What Chaperone changes |
|---|---|
| Freysa, Grok/Bankrbot: the model is talked into paying | Being convinced is not enough. The payment still needs an allowlisted recipient, an amount under the caps, and a valid checker verdict. In our testnet demo the injected 500 USDC payment is refused with 11 reason codes. |
| Grok/Bankrbot: an NFT expanded the wallet's permissions | Permissions change only through `set_policy`, which needs the owner's full-access key and 1 yoctoNEAR. Nothing the agent receives can widen what it may do. |
| AIXBT: the runtime itself is compromised | Even a fully compromised agent holds only a function-call key. It cannot forge the checker's signature (`BAD_SIGNATURE` in our demo) and cannot exceed the caps. The owner can `revoke_all` in one transaction. |
| ElizaOS memory injection: poisoned context persists | Enforcement does not depend on what the agent remembers. The contract checks every request fresh. |
| OpenAI: the agent decides spending is fine | The agent's opinion of its own permission is irrelevant; the contract's is final. |
| BEC invoice redirect | New recipients wait out a timelock unless the owner allowlisted them, and known-bad accounts are blocked by the checker. |

## Why NEAR, and why now

- NEAR's founder has named this exact need. On Bankless (March 24, 2026) Illia Polosukhin
  called security "the biggest bottleneck right now" for agents, and described attaching
  policies to agent keys, for example "spend $100 a day on unknown addresses"
  ([Bankless](https://www.bankless.com/podcast/illia-polosukhin-near-founder-on-ironclaw)).
  He has also said "the users of blockchain will be AI agents"
  ([CoinDesk, March 3, 2026](https://www.coindesk.com/tech/2026/03/03/ai-agents-will-be-primary-users-of-blockchain-near-co-founder-says)).
  Chaperone is that policy layer, built as an open contract any NEAR agent can use.
- NEAR is one of the few chains where this needs no new cryptography: **function-call
  access keys** are a protocol feature. The agent's limits are enforced by the protocol and
  a contract, not by an SDK the agent could bypass.
- Agents are already paying on-chain at scale in count, mostly in tiny amounts (x402 has
  processed well over 100 million payments, [Chainalysis via AI Weekly](https://aiweekly.co/alerts/chainalysis-base-x402-agentic-payments-hit-138m-in-q3-with-87-under-10-cents)).
  The value per payment is small today; the trust gap is what keeps it small.

## Business model

The contract is open source and free to deploy. Revenue comes from the parts that need
operating (proposed, not live):

1. **Hosted risk checker.** A free tier of verdicts per month per vault, then a per-verdict
   fee (fractions of a cent, payable per request, so it scales with agent activity) or a
   flat monthly plan for teams.
2. **Shared threat feed.** The blocklist and counterparty reputation built from every
   vault's refusals, licensed to wallets, agent frameworks and exchanges that want the same
   signal.
3. **Teams and compliance.** Multiple approvers, approval routing (e.g. chat or email),
   exportable audit logs for accountants, and managed policies across many agents.

Who pays: teams running agents that spend (accounts-payable agents, research agents
buying data, trading and treasury agents, agent marketplaces that need per-agent budgets).

## Sponsors and bounties

This hackathon has no sponsor bounties, and we did not apply to any. The build uses free
infrastructure only: NEAR testnet, Circle testnet USDC, FastNEAR public RPC, NearBlocks
API v3, Meteor and Intear wallets, and optionally NEAR AI Cloud as the agent's model.
