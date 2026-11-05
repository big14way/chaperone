// pnpm keygen  -  new ed25519 checker key. Put both lines in .env; the public key goes into the
// vault at init (deploy-testnet.sh) and can be rotated later with set_checker.
import { generateCheckerKey } from "../checker/src/verdict.ts";

const k = generateCheckerKey();
console.log(`CHECKER_SECRET_KEY=${k.secretKey}`);
console.log(`CHECKER_PUBLIC_KEY=${k.publicKey}`);
