# ClassPrefixer

Prefix CSS class names in React files (JS/TS/JSX/TSX). Supports wildcard/regex attribute names and strings inside JSX expressions.

## Features

- Add or remove a configurable prefix from class lists.
- Works on:
  - className="..." and className={'...'}/{"..."}/`...` (direct strings)
  - Strings inside JSX expressions, e.g. `className={twMerge('a', cond && "b", other)}` — single/double-quoted strings only.
  - Custom attribute names matched via wildcards (e.g. `*ClassName`) or regex patterns.
- Skip exact class names via a skip list.
- Optional auto-format after edits.
- Targets only JS/TS/JSX/TSX files (does not process plain HTML `class="..."`).

## Commands

- ClassPrefixer: Add Class Prefix — `classPrefixer.addPrefix`
- ClassPrefixer: Remove Class Prefix — `classPrefixer.removePrefix`

## Settings

- `classPrefixer.prefix` (string, default: `"ssp:"`)  
  Prefix to add to matching class names.
- `classPrefixer.skipClasses` (string[], default: `[]`)  
  Exact class names to skip (no prefix added/removed).
- `classPrefixer.autoFormat` (boolean, default: `true`)  
  Run “Format Document” after edits.
- `classPrefixer.customPatterns` (string[], default: `["*ClassName"]`)  
  Attribute name patterns using `*` wildcard. Example: `*ClassName` matches `testClassName`.
- `classPrefixer.useRegex` (boolean, default: `false`)  
  If true, use `customRegexPatterns` instead of `customPatterns`.
- `classPrefixer.customRegexPatterns` (string[], default: `["\\w+ClassName"]`)  
  Raw regex patterns (without slashes) matched against attribute names.

## Usage

1. Open a supported file (.js/.jsx/.ts/.tsx).
2. Run “ClassPrefixer: Add Class Prefix” (or “Remove Class Prefix”) from the Command Palette or the editor context menu.

## Example

Input:

```tsx
<div
  className={twMerge('header main', isActive && 'active')}
  testClassName="x y"
/>
```
