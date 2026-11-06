# Fixtures

A real dstack (Intel TDX) attestation served publicly by NEAR AI Cloud for `deepseek-ai/DeepSeek-V4.1-Flash-1017`
(`GET https://cloud-api.near.ai/v1/attestation/report`), and the Intel DCAP collateral for its quote fetched from
Phala's PCCS with `attest collateral`. Used to test the verifier and the on-chain `register_checker` path.
The collateral expires (about 30 days); refresh with `cargo run -p attest -- collateral nearai_quote.hex`.
