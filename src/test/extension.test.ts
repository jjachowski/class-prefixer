import * as assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

const normalizeEOL = (s: string) => s.replace(/\r\n/g, '\n');

// Remove leading/trailing blank lines and common leading indentation
const dedent = (s: string) => {
  const lines = normalizeEOL(s).split('\n');

  // Trim leading/trailing completely blank lines
  while (lines.length && lines[0].trim() === '') {
    lines.shift();
  }
  while (lines.length && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  // Find minimum indent across non-empty lines
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^\s*/)?.[0].length ?? 0);
  const minIndent = indents.length ? Math.min(...indents) : 0;

  // Remove that indent
  const out = lines
    .map((l) => l.slice(Math.min(minIndent, l.length)))
    .join('\n');
  return out.trimEnd(); // don’t care about trailing newline
};

const norm = (s: string) => dedent(s);

async function updateConfig(
  values: Partial<{
    prefix: string;
    skipClasses: string[];
    autoFormat: boolean;
    customPatterns: string[];
    useRegex: boolean;
    customRegexPatterns: string[];
  }>
) {
  const cfg = vscode.workspace.getConfiguration('classPrefixer');
  const entries = Object.entries(values) as [keyof typeof values, any][];
  for (const [key, val] of entries) {
    await cfg.update(key, val, vscode.ConfigurationTarget.Global);
  }
  // Give VS Code a tick to propagate settings
  await wait(50);
}

async function ensureActivated() {
  // Open a TSX file to trigger activation (activationEvents are onLanguage)
  await withTempEditor('tsx', '<div className="x"></div>', async () => {});
}

async function withTempEditor<T>(
  ext: 'tsx' | 'jsx' | 'ts' | 'js' | 'html',
  content: string,
  fn: (doc: vscode.TextDocument, editor: vscode.TextEditor) => Promise<T> | T
): Promise<T> {
  const dir = path.join(os.tmpdir(), 'class-prefixer-tests');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(
    dir,
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  );
  await fs.writeFile(file, content, 'utf8');

  const uri = vscode.Uri.file(file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  await wait(25); // let VS Code settle focus/activation

  try {
    return await fn(doc, editor);
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await fs.unlink(file).catch(() => {});
  }
}

async function runAdd() {
  await vscode.commands.executeCommand('classPrefixer.addPrefix');
  // Let edits apply
  await wait(25);
}

async function runRemove() {
  await vscode.commands.executeCommand('classPrefixer.removePrefix');
  await wait(25);
}

suite('ClassPrefixer Test Suite', () => {
  vscode.window.showInformationMessage('Start ClassPrefixer tests.');

  suiteSetup(async () => {
    await ensureActivated();
  });

  setup(async () => {
    // Baseline config for most tests
    await updateConfig({
      prefix: 'app-',
      skipClasses: [],
      autoFormat: false, // avoid formatter interference
      customPatterns: ['*ClassName'], // enable wildcard attrs
      useRegex: false,
      customRegexPatterns: [],
    });
  });

  teardown(async () => {
    // Close editors between tests
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('Direct: className="..." gets prefixed', async () => {
    const input = `<div className="foo bar baz"></div>`;
    const expected = `<div className="app-foo app-bar app-baz"></div>`;

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Direct: skipClasses prevents prefixing', async () => {
    const input = `<div className="foo bar baz"></div>`;
    const expected = `<div className="app-foo bar app-baz"></div>`;

    await updateConfig({ skipClasses: ['bar'] });

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Direct: does not double-prefix', async () => {
    const input = `<div className="app-foo bar"></div>`;
    const expected = `<div className="app-foo app-bar"></div>`;

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Direct: removePrefix removes only the configured prefix', async () => {
    const input = `<div className="app-foo app-bar baz"></div>`;
    const expected = `<div className="foo bar baz"></div>`;

    await withTempEditor('tsx', input, async (doc) => {
      await runRemove();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Custom wildcard: "*ClassName" matches e.g., testClassName', async () => {
    const input = `<div testClassName="x y"></div>`;
    const expected = `<div testClassName="app-x app-y"></div>`;

    await updateConfig({ customPatterns: ['*ClassName'] });

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Custom wildcard: multiple custom names work', async () => {
    const input = `<div wrapperClassName="x" containerClassName="y z"></div>`;
    const expected = `<div wrapperClassName="app-x" containerClassName="app-y app-z"></div>`;

    await updateConfig({
      customPatterns: ['*ClassName', 'containerClassName'],
    });

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Custom regex (useRegex = true): matches direct quoted attributes', async () => {
    const input = `<div fooClassName="x y" barClass="a b"></div>`;
    const expected = `<div fooClassName="app-x app-y" barClass="app-a app-b"></div>`;

    await updateConfig({
      useRegex: true,
      customRegexPatterns: ['\\w+ClassName', '\\w+Class'],
    });

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Expressions: prefixes single and double quoted strings inside {...}', async () => {
    const input = `
      <div
        className={twMerge('header main', isActive && "active", maybe && 'hidden')}
        testClassName={clsx(foo, "x y", cond && 'z')}
      ></div>
    `;
    const expected = `
      <div
        className={twMerge('app-header app-main', isActive && "app-active", maybe && 'app-hidden')}
        testClassName={clsx(foo, "app-x app-y", cond && 'app-z')}
      ></div>
    `;

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(norm(doc.getText()), norm(expected));
    });
  });

  test('Expressions: respects skipClasses inside {...}', async () => {
    const input = `<div className={twMerge('header', condition && "hidden", 'footer')}></div>`;
    const expected = `<div className={twMerge('app-header', condition && "hidden", 'app-footer')}></div>`;

    await updateConfig({ skipClasses: ['hidden'] });

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Expressions: does NOT change template literals inside {...}', async () => {
    const input = `<div className={twMerge(\`btn-\${size}\`, "primary", 'secondary')}></div>`;
    const expected = `<div className={twMerge(\`btn-\${size}\`, "app-primary", 'app-secondary')}></div>`;

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Expressions: nested conditionals and grouping', async () => {
    const input = `
      <div
        className={isA ? ('one two') : (isB ? "three four" : 'five')}
        testClassName={cond && (fn("alpha beta"), 'gamma delta')}
      ></div>
    `;
    const expected = `
      <div
        className={isA ? ('app-one app-two') : (isB ? "app-three app-four" : 'app-five')}
        testClassName={cond && (fn("app-alpha app-beta"), 'app-gamma app-delta')}
      ></div>
    `;

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(norm(doc.getText()), norm(expected));
    });
  });

  test('Remove: removes prefixes from strings inside expressions', async () => {
    const input = `<div className={twMerge('app-a app-b', cond && "app-c", other)}></div>`;
    const expected = `<div className={twMerge('a b', cond && "c", other)}></div>`;

    await withTempEditor('tsx', input, async (doc) => {
      await runRemove();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('JSX: does not touch plain HTML class (not targeted)', async () => {
    const input = `<div class="foo bar" className="x y"></div>`;
    const expected = `<div class="foo bar" className="app-x app-y"></div>`;

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Unsupported file type: command should not change HTML files', async () => {
    const input = `<div class="foo bar" className="x y"></div>`;

    // Ensure extension is already activated (suiteSetup did this)
    await withTempEditor('html', input, async (doc) => {
      await runAdd(); // should early-return without changes
      assert.strictEqual(doc.getText(), input);
    });
  });

  test('Works in .jsx as well', async () => {
    const input = `<div className={'x y'}></div>`;
    const expected = `<div className={'app-x app-y'}></div>`;

    await withTempEditor('jsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Works in .ts as a raw string pattern (still text replace)', async () => {
    const input = `const tpl = '<div className="x y"></div>';`;
    const expected = `const tpl = '<div className="app-x app-y"></div>';`;

    await withTempEditor('ts', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });

  test('Custom prefix value is respected', async () => {
    const input = `<div className="foo bar"></div>`;
    const expected = `<div className="x-foo x-bar"></div>`;

    await updateConfig({ prefix: 'x-' });

    await withTempEditor('tsx', input, async (doc) => {
      await runAdd();
      assert.strictEqual(doc.getText(), expected);
    });
  });
});
