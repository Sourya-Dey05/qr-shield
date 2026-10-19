import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  payload?: string;
  keyPath?: string;
  upiId?: string;
  help?: boolean;
} {
  const args = argv.slice(2);
  const result: {
    payload?: string;
    keyPath?: string;
    upiId?: string;
    help?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--payload" || args[i] === "-p") && args[i + 1]) {
      result.payload = args[++i];
    } else if ((args[i] === "--key" || args[i] === "-k") && args[i + 1]) {
      result.keyPath = args[++i];
    } else if ((args[i] === "--upi" || args[i] === "-u") && args[i + 1]) {
      result.upiId = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      result.help = true;
    }
  }

  return result;
}

function printUsage(): void {
  /* eslint-disable no-console */
  console.log(`
QR-Shield Signing Helper (Phase 4)

Usage:
  npx tsx tools/sign-qr.ts --payload <string> --key <path-to-private-key.pem> [--upi <merchant@upi>]

Options:
  --payload, -p   QR payload string to sign (e.g. upi://pay?pa=testmerchant@upi&pn=Store&am=100)
  --key, -k       Path to PEM-encoded RSA private key
  --upi, -u       Optional merchant UPI ID to include in the JSON snippet
  --help, -h      Display this help message
`);
  /* eslint-enable no-console */
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help || !args.payload || !args.keyPath) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const resolvedKey = path.resolve(args.keyPath);
  let privateKeyPem: string;

  try {
    privateKeyPem = fs.readFileSync(resolvedKey, "utf-8");
  } catch (err) {
    /* eslint-disable no-console */
    console.error(`Error: Cannot read private key from ${resolvedKey}`);
    console.error((err as Error).message);
    /* eslint-enable no-console */
    process.exit(1);
  }

  let signature: string;
  try {
    const signer = crypto.createSign("SHA256");
    signer.update(args.payload, "utf-8");
    signer.end();
    signature = signer.sign(privateKeyPem, "base64");
  } catch (err) {
    /* eslint-disable no-console */
    console.error(
      "Error: Signing failed — ensure the key is a valid RSA PKCS#8 or PKCS#1 PEM"
    );
    console.error((err as Error).message);
    /* eslint-enable no-console */
    process.exit(1);
  }

  /* eslint-disable no-console */
  console.log("\n─── QR-Shield Sign-QR Tool ─────────────────────────────────────");
  console.log(`Payload   : ${args.payload}`);
  console.log(`Key file  : ${resolvedKey}`);
  console.log("─────────────────────────────────────────────────────────────────");
  console.log(`Signature (base64):`);
  console.log(signature);
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("\nJSON snippet for POST /api/validate:");
  console.log(
    JSON.stringify(
      {
        ...(args.upiId ? { upiId: args.upiId } : {}),
        payload: args.payload,
        signature,
      },
      null,
      2
    )
  );
  console.log();
  /* eslint-enable no-console */
}

main();
