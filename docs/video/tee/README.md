# Live TEE clip

A 68-second clip of the attested checker, recorded live on 7 Nov 2026: the checker image deployed to a Phala Cloud
Intel TDX CVM, `pnpm tee attest`, `pnpm tee policy`, `pnpm tee register` (the vault verifies the quote on chain),
the dashboard reading the attested checker from the contract, and enclave-signed verdicts on testnet. Afterwards TEE
mode was turned off and the CVM deleted.

- `run.sh` ran each command and stamped every output line with the time (`logs/*.log`, the real output).
- `make_term.cjs` turns the logs into terminal replays at real speed (`schedules/`), dropping only long JSON views,
  the agent's prose and a local file path.
- `scenes.json` / `term_scenes.json` are the recorder configs (dashboard on a local build of `web/`, terminal replays);
  the Phala screens are screenshots from the owner's browser taken during the deploy.
- `demo.json` is the cut (pitch-video builder, Edge neural narration); `music.py` is the original score
  (darkwave: detuned saw arpeggios, pumping pad, analog bass, 100 BPM, A minor), mixed under the narration.

Transactions from this run: register [GRVbEdFD…](https://testnet.nearblocks.io/txns/GRVbEdFDueUmuF17tA9JVbnnVSerGFT5xtju4qRkJ6by),
policy [4yBNxN9m…](https://testnet.nearblocks.io/txns/4yBNxN9m7wJJNLecsLm2UQk1Jt4tuQHgsdwHzdC8CdJA),
enclave ALLOW [DcLtKiuU…](https://testnet.nearblocks.io/txns/DcLtKiuUzMRgVz9vxYiWidEb9FWf7eDz6mLV9D4ZDaCL),
real invoice paid [EqD3Dbdk…](https://testnet.nearblocks.io/txns/EqD3DbdkoadnH7t3m6KjPu561Psx3iEaPut4C69LW9pb),
BLOCK [MqfyrNyn…](https://testnet.nearblocks.io/txns/MqfyrNyn8bwpykCfpjG3igrvTGuHv3TLUta6N7UhFZv),
self-signed verdict refused [3wqsEBkt…](https://testnet.nearblocks.io/txns/3wqsEBktTTWXo5ouJD2WyyVnwq8bL6CrZchGConK5gLq),
TEE mode off [9tSKH3me…](https://testnet.nearblocks.io/txns/9tSKH3me2x3qqvhgPAdFTbPcmn3AEgkGka9nZPYC9Jkp) and
hosted key restored [7iffypGj…](https://testnet.nearblocks.io/txns/7iffypGjtRjc5GgxLhCGqvqwrMjGzLxjorMJWSjGsMTv).
The rendered MP4 lives outside the repo.
