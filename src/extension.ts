import * as vscode from 'vscode';

const SUPPORTED_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

interface ClassPrefixerConfig {
  prefix: string;
  skipClasses: string[];
  autoFormat: boolean;
  customPatterns: string[];
  useRegex: boolean;
  customRegexPatterns: string[];
}

export function activate(context: vscode.ExtensionContext) {
  console.log('ClassPrefixer is now active!');

  const addPrefixCommand = vscode.commands.registerCommand(
    'classPrefixer.addPrefix',
    async () => {
      await processDocument(true);
    }
  );

  const removePrefixCommand = vscode.commands.registerCommand(
    'classPrefixer.removePrefix',
    async () => {
      await processDocument(false);
    }
  );

  context.subscriptions.push(addPrefixCommand, removePrefixCommand);

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '$(symbol-class) ClassPrefixer';
  statusBarItem.tooltip = 'Click to add class prefix';
  statusBarItem.command = 'classPrefixer.addPrefix';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

function getConfig(): ClassPrefixerConfig {
  const config = vscode.workspace.getConfiguration('classPrefixer');
  return {
    prefix: config.get<string>('prefix') || 'app-',
    skipClasses: config.get<string[]>('skipClasses') || [],
    autoFormat: config.get<boolean>('autoFormat') || true,
    customPatterns: config.get<string[]>('customPatterns') || [],
    useRegex: config.get<boolean>('useRegex') || false,
    customRegexPatterns: config.get<string[]>('customRegexPatterns') || [],
  };
}

function isFileSupported(fileName: string): boolean {
  return SUPPORTED_EXTENSIONS.some((ext) =>
    fileName.toLowerCase().endsWith(ext)
  );
}

function buildPatternsFromCustom(config: {
  customPatterns: string[];
}): RegExp[] {
  const patterns: RegExp[] = [];

  const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[```{}|]/g, '\\$&');
  const toNameRegex = (wild: string) =>
    // turn "*" into [\w$-]* and escape the rest
    wild.split('*').map(escapeRegExp).join('[\\w$-]*');

  // Only custom names here; "className" is handled in buildPatterns base
  const names = config.customPatterns?.length
    ? config.customPatterns
    : ['*ClassName'];

  Array.from(new Set(names)).forEach((wild) => {
    const nameRegex = toNameRegex(wild); // e.g. "*ClassName" -> [\w$-]*ClassName
    const attr = `(?:${nameRegex})`;

    // Direct quoted attributes only (attr="..."/'...'/`...`)
    patterns.push(new RegExp(`${attr}\\s*=\\s*["'\`]([^"'\`]*)["'\`]`, 'g'));
  });

  return patterns;
}

function buildPatterns(config: ClassPrefixerConfig): RegExp[] {
  const patterns: RegExp[] = [/className\s*=\s*["'`]([^"'`]*?)["'`]/g];

  if (config.useRegex) {
    // User-provided regex attribute names for direct quoted values
    config.customRegexPatterns.forEach((pattern) => {
      try {
        patterns.push(
          new RegExp(`(?:${pattern})\\s*=\\s*["'\`]([^"'\`]*)["'\`]`, 'g')
        );
      } catch (e) {
        console.error(`Invalid regex pattern: ${pattern}`, e);
        vscode.window.showWarningMessage(
          `ClassPrefixer: Invalid regex pattern: ${pattern}`
        );
      }
    });
  } else {
    patterns.push(...buildPatternsFromCustom(config));
  }

  return patterns;
}

// Reusable escape for wildcard conversion
const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[```{}|]/g, '\\$&');

// Build one alternation regex for attribute names (default + custom)
function buildAttrNameAlternation(config: ClassPrefixerConfig): string {
  const parts: string[] = ['className']; // always include className

  if (config.useRegex) {
    // Use provided regex as-is
    parts.push(...config.customRegexPatterns.filter(Boolean));
  } else {
    const toNameRegex = (wild: string) =>
      wild.split('*').map(escapeRegExp).join('[\\w$-]*');

    const names = config.customPatterns?.length
      ? config.customPatterns
      : ['*ClassName'];
    parts.push(...names.map(toNameRegex));
  }

  // De-dup and build alternation
  const unique = Array.from(new Set(parts));
  return `(?:${unique.join('|')})`;
}

// Find the index of the matching closing '}' starting at openIndex (which points to '{')
function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];

    if (inSingle) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inBacktick) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '`') {
        inBacktick = false;
        continue;
      }
      // Ignore everything inside template literals (including ${...})
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inBacktick = true;
      continue;
    }

    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
      continue;
    }
  }
  return -1; // not found
}

// Replace '...' and "..." inside a string, ignoring template literals
function replaceQuotedStringsIgnoringTemplates(
  input: string,
  replacer: (content: string, quote: '"' | "'") => string
): string {
  let out = '';
  let i = 0;
  let inBacktick = false;

  while (i < input.length) {
    const ch = input[i];

    if (inBacktick) {
      // Copy template literal raw (basic: skip to next unescaped backtick)
      out += ch;
      if (ch === '\\') {
        if (i + 1 < input.length) {
          out += input[i + 1];
          i += 2;
          continue;
        }
      }
      if (ch === '`') {
        inBacktick = false;
      }
      i++;
      continue;
    }

    if (ch === '`') {
      inBacktick = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch as '"' | "'";
      let j = i + 1;
      let content = '';

      while (j < input.length) {
        const c = input[j];
        if (c === '\\') {
          if (j + 1 < input.length) {
            content += c + input[j + 1];
            j += 2;
            continue;
          } else {
            content += c;
            j++;
            continue;
          }
        }
        if (c === quote) {
          break;
        }
        content += c;
        j++;
      }

      if (j < input.length && input[j] === quote) {
        const replaced = replacer(content, quote);
        out += quote + replaced + quote;
        i = j + 1;
        continue;
      } else {
        // Unclosed string, just emit current char
        out += ch;
        i++;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

// Process strings inside JSX expression values: attrName={ ...here... }
function processExpressionAttributeLiterals(
  text: string,
  config: ClassPrefixerConfig,
  addPrefix: boolean
): string {
  const attrAlt = buildAttrNameAlternation(config);
  const startRe = new RegExp(`${attrAlt}\\s*=\\s*\\{`, 'g');

  let result = '';
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = startRe.exec(text)) !== null) {
    const openBraceIndex = startRe.lastIndex - 1; // points to '{'
    const closeIndex = findMatchingBrace(text, openBraceIndex);
    if (closeIndex === -1) {
      // Unbalanced braces; skip this occurrence
      continue;
    }

    const before = text.slice(lastIndex, openBraceIndex + 1); // include '{'
    const body = text.slice(openBraceIndex + 1, closeIndex);
    const afterClose = closeIndex + 1;

    const transformedBody = replaceQuotedStringsIgnoringTemplates(
      body,
      (content) => {
        return processClasses(
          content,
          config.prefix,
          addPrefix ? config.skipClasses : [],
          addPrefix
        );
      }
    );

    result += before + transformedBody + '}';
    lastIndex = afterClose;

    // Move regex index forward to avoid re-matching inside replaced area
    startRe.lastIndex = afterClose;
  }

  result += text.slice(lastIndex);
  return result;
}

async function processDocument(addPrefix: boolean) {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage('ClassPrefixer: open file first');
    return;
  }

  if (!isFileSupported(editor.document.fileName)) {
    vscode.window.showWarningMessage(
      'ClassPrefixer: This file type is not supported. Supported file types: .js, .jsx, .ts, .tsx'
    );
    return;
  }

  const config = getConfig();
  const document = editor.document;

  try {
    const fullText = document.getText();
    const processedText = addPrefix
      ? addPrefixToClasses(fullText, config)
      : removePrefixFromClasses(fullText, config);

    if (fullText === processedText) {
      vscode.window.showInformationMessage(
        addPrefix
          ? 'ClassPrefixer: Did not find any classes to prefix'
          : 'ClassPrefixer: Did not find any prefixes to remove'
      );
      return;
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(fullText.length)
    );

    await editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, processedText);
    });

    if (config.autoFormat) {
      await vscode.commands.executeCommand('editor.action.formatDocument');
    }

    vscode.window.showInformationMessage(
      addPrefix
        ? `ClassPrefixer: Prefix "${config.prefix}" added`
        : `ClassPrefixer: Prefix "${config.prefix}" removed`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`ClassPrefixer Error: ${error}`);
  }
}

function addPrefixToClasses(text: string, config: ClassPrefixerConfig): string {
  const { prefix, skipClasses } = config;

  // Direct quoted values
  const patterns = buildPatterns(config);
  let result = text;

  patterns.forEach((pattern) => {
    result = result.replace(pattern, (match, classes) => {
      const processedClasses = processClasses(
        classes,
        prefix,
        skipClasses,
        true
      );
      return match.replace(classes, processedClasses);
    });
  });

  // Strings within JSX expressions: className={ ... '...' ... }
  result = processExpressionAttributeLiterals(result, config, true);

  return result;
}

function removePrefixFromClasses(
  text: string,
  config: ClassPrefixerConfig
): string {
  const { prefix } = config;

  // Direct quoted values
  const patterns = buildPatterns(config);
  let result = text;

  patterns.forEach((pattern) => {
    result = result.replace(pattern, (match, classes) => {
      const processedClasses = processClasses(classes, prefix, [], false);
      return match.replace(classes, processedClasses);
    });
  });

  // Strings within JSX expressions: className={ ... '...' ... }
  result = processExpressionAttributeLiterals(result, config, false);

  return result;
}

function processClasses(
  classString: string,
  prefix: string,
  skipClasses: string[],
  addPrefix: boolean
): string {
  const classes = classString.split(/\s+/).filter((c) => c.length > 0);

  const processedClasses = classes.map((className) => {
    if (!className) {
      return className;
    }

    if (addPrefix) {
      if (className.startsWith(prefix)) {
        return className;
      }
      if (skipClasses.includes(className)) {
        return className;
      }

      return prefix + className;
    } else {
      if (className.startsWith(prefix)) {
        return className.substring(prefix.length);
      }
      return className;
    }
  });

  return processedClasses.join(' ');
}

export function deactivate() {
  console.log('ClassPrefixer has been deactivated');
}
