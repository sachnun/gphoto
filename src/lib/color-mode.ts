if (!process.stdout.isTTY || process.env.TERM === "dumb") process.env.NO_COLOR = "1";
