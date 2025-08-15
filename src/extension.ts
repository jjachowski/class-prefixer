import * as vscode from 'vscode';

// Wspierane rozszerzenia plików
const SUPPORTED_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

// Configuration interface
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

  // Komenda dodawania prefiksów
  const addPrefixCommand = vscode.commands.registerCommand(
    'classPrefixer.addPrefix',
    async () => {
      await processDocument(true);
    }
  );

  // Komenda usuwania prefiksów
  const removePrefixCommand = vscode.commands.registerCommand(
    'classPrefixer.removePrefix',
    async () => {
      await processDocument(false);
    }
  );

  context.subscriptions.push(addPrefixCommand, removePrefixCommand);

  // Pokazanie statusu w status bar
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

// Get configuration
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

// Sprawdź czy plik jest obsługiwany
function isFileSupported(fileName: string): boolean {
  return SUPPORTED_EXTENSIONS.some((ext) =>
    fileName.toLowerCase().endsWith(ext)
  );
}

// // Build patterns from wildcard attribute names like "*ClassName"
// function buildPatternsFromCustom(config: {
//   customPatterns: string[];
// }): RegExp[] {
//   const patterns: RegExp[] = [
//     // keep HTML class
//     /\sclass\s*=\s*["']([^"']*)/g,
//   ];

//   const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[```{}|]/g, '\\$&');

//   const toNameRegex = (wild: string) =>
//     // turn "*" into [\w$-]* and escape the rest
//     wild.split('*').map(escapeRegExp).join('[\\w$-]*');

//   // Use defaults if nothing configured
//   const names = config.customPatterns?.length
//     ? config.customPatterns
//     : ['className', '*ClassName'];

//   // De-dup to avoid double-processing
//   Array.from(new Set(names)).forEach((wild) => {
//     const nameRegex = toNameRegex(wild); // e.g. "*ClassName" -> [\w$-]*ClassName
//     // Non-capturing group for the attribute name so the ONLY capture group is the value
//     const attr = `(?:${nameRegex})`;

//     // Matches: attr="...", attr='...', attr=`...`, and attr={...} (simple way)
//     patterns.push(new RegExp(`${attr}\\s*=\\s*["'\`{]([^"'\\\`}]*)`, 'g'));
//   });

//   return patterns;
// }

function buildPatternsFromCustom(config: {
  customPatterns: string[];
}): RegExp[] {
  const patterns: RegExp[] = [];

  const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[```{}|]/g, '\\$&');
  const toNameRegex = (wild: string) =>
    wild.split('*').map(escapeRegExp).join('[\\w$-]*');

  const names = config.customPatterns?.length
    ? config.customPatterns
    : ['className', '*ClassName'];

  Array.from(new Set(names)).forEach((wild) => {
    const nameRegex = toNameRegex(wild);
    const attr = `(?:${nameRegex})`;
    patterns.push(new RegExp(`${attr}\\s*=\\s*["'\`{]([^"'\\\`}]*)`, 'g'));
  });

  return patterns;
}

// Build regex patterns from configuration
function buildPatterns(config: ClassPrefixerConfig): RegExp[] {
  const patterns: RegExp[] = [
    // Default patterns for className and class
    /className\s*=\s*["'`]([^"'`]*?)["'`]/g,
    /className\s*=\s*\{["'`]([^"'`]*?)["'`]\}/g,
    /className\s*=\s*\{`([^`]*?)`\}/g,
  ];

  if (config.useRegex) {
    // Use regex patterns directly
    config.customRegexPatterns.forEach((pattern) => {
      try {
        // Create regex for attribute="value" format
        const regex = new RegExp(
          `(${pattern})\\s*=\\s*["'\`]([^"'\`]*?)["'\`]`,
          'g'
        );
        patterns.push(regex);
        // Also support {`...`} and {'...'} formats for JSX
        const regexJsx = new RegExp(
          `(${pattern})\\s*=\\s*\\{["'\`]([^"'\`]*?)["'\`]\\}`,
          'g'
        );
        patterns.push(regexJsx);
      } catch (e) {
        console.error(`Invalid regex pattern: ${pattern}`, e);
        vscode.window.showWarningMessage(
          `ClassPrefixer: Invalid regex pattern: ${pattern}`
        );
      }
    });
  } else {
    const xzd = buildPatternsFromCustom(config);
    patterns.push(...xzd);
  }

  return patterns;
}

// Główna funkcja przetwarzania dokumentu
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

    // Automatyczne formatowanie jeśli włączone
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

// Dodaj prefiksy do klas
function addPrefixToClasses(text: string, config: ClassPrefixerConfig): string {
  const { prefix, skipClasses } = config;

  // Wzorce dla className i class attributes
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

  return result;
}

// Usuń prefiksy z klas
function removePrefixFromClasses(
  text: string,
  config: ClassPrefixerConfig
): string {
  const { prefix } = config;

  const patterns = [
    /className\s*=\s*["'`{]([^"'`}]*)/g,
    /\sclass\s*=\s*["']([^"']*)/g,
  ];

  let result = text;

  patterns.forEach((pattern) => {
    result = result.replace(pattern, (match, classes) => {
      const processedClasses = processClasses(classes, prefix, [], false);
      return match.replace(classes, processedClasses);
    });
  });

  return result;
}

// Przetwórz pojedyncze klasy
function processClasses(
  classString: string,
  prefix: string,
  skipClasses: string[],
  addPrefix: boolean
): string {
  // Rozdziel klasy (obsługa wielu klas)
  const classes = classString.split(/\s+/).filter((c) => c.length > 0);

  const processedClasses = classes.map((className) => {
    // Pomiń puste lub już prefixowane (jeśli dodajemy)
    if (!className) {
      return className;
    }

    if (addPrefix) {
      // Nie dodawaj jeśli już ma prefiks
      if (className.startsWith(prefix)) {
        return className;
      }
      // Nie dodawaj do klas na liście skip
      if (skipClasses.includes(className)) {
        return className;
      }

      return prefix + className;
    } else {
      // Usuń prefiks jeśli istnieje
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
