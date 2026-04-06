# i18n-hunter 🏹

The global, zero-config CLI hunter for hardcoded strings. Designed for Vue, React, and beyond.

[![NPM Version](https://img.shields.io/npm/v/i18n-hunter)](https://www.npmjs.com/package/i18n-hunter)

## Features

- 🎯 **Per-File Intelligence**: Automatically uses the correct engine (Vue or React/JSX) based on file extensions.
- 📂 **Flexible Hunting**: Scan entire directories or specific files directly.
- 🧠 **Zero Setup**: No configuration required. Just point and hunt.
- 🏷️ **Categorization**: Groups strings into Labels, Buttons, Messages, Errors, and Notifications.
- 📊 **Dual Reporting**: Exports professional reports in Markdown and JSON.

## Quick Start

```bash
# Scan current directory
npx i18n-hunter

# Scan a specific file
npx i18n-hunter --paths src/App.tsx

# Scan a specific folder
npx i18n-hunter --paths examples/vue-app/src
```

## How it works

`i18n-hunter` is engine-agnostic at the project level but engine-aware at the file level:

- **.vue files**: Handled by the Vue component parser.
- **.tsx, .jsx, .ts, .js**: Handled by the high-performance JSX/Script engine.

This allows you to scan hybrid projects or focus on specific modules without any framework locks.

## Commands & Options

| Flag | Description | Default |
| --- | --- | --- |
| `--paths` | Comma-separated **files** or **directories** | Auto-detected |
| `--output` | Directory for generated reports | `./i18n-reports` |
| `--format` | Output formats: `json`, `md` | `json,md` |
| `--base` | Base root path | `process.cwd()` |

## Example Usage

### Scan a React component directly

```bash
i18n-hunter --paths src/components/Header.tsx
```

### Scan everything in a Vue view

```bash
i18n-hunter --paths src/views/Dashboard
```

## License

MIT © [tiepviet](https://github.com/tiepviet)
