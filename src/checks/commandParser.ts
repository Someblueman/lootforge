export interface ParsedCommand {
  command: string;
  args: string[];
}

export function parseCommandLine(commandLine: string): ParsedCommand {
  const tokens = tokenizeCommandLine(commandLine);
  if (tokens.length === 0) {
    throw new Error("Command must be a non-empty string.");
  }

  return {
    command: tokens[0],
    args: tokens.slice(1),
  };
}

function tokenizeCommandLine(commandLine: string): string[] {
  if (!commandLine.trim()) {
    throw new Error("Command must be a non-empty string.");
  }

  const tokens: string[] = [];
  let token = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let tokenStarted = false;

  while (i < commandLine.length) {
    const char = commandLine[i];

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
        tokenStarted = true;
      } else {
        token += char;
        tokenStarted = true;
      }
      i += 1;
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
        tokenStarted = true;
        i += 1;
        continue;
      }
      if (char === "\\" && i + 1 < commandLine.length) {
        token += commandLine[i + 1];
        tokenStarted = true;
        i += 2;
        continue;
      }
      token += char;
      tokenStarted = true;
      i += 1;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      tokenStarted = true;
      i += 1;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      tokenStarted = true;
      i += 1;
      continue;
    }

    if (char === "\\") {
      if (i + 1 < commandLine.length) {
        token += commandLine[i + 1];
        tokenStarted = true;
        i += 2;
      } else {
        token += "\\";
        tokenStarted = true;
        i += 1;
      }
      continue;
    }

    if (/\s/u.test(char)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      i += 1;
      continue;
    }

    token += char;
    tokenStarted = true;
    i += 1;
  }

  if (inSingleQuote || inDoubleQuote) {
    throw new Error(`Unmatched quote in command: ${commandLine}`);
  }

  if (tokenStarted) {
    tokens.push(token);
  }

  return tokens;
}
