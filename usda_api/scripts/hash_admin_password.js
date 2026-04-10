const bcrypt = require("bcryptjs");

const pw = process.env.PW;
if (!pw) {
  process.stderr.write("Set PW env var. Example: PW='your-password' node scripts/hash_admin_password.js\n");
  process.exit(2);
}

const rounds = 12;
const hash = bcrypt.hashSync(pw, rounds);
process.stdout.write(hash + "\n");
