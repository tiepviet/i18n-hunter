# Security Policy

## Supported versions

Security fixes are provided for the latest 0.2.x release. Version 0.1.x reports a source-mutating workflow with known path and rollback risks and must not be used on untrusted reports.

## Reporting

Report suspected vulnerabilities privately through GitHub Security Advisories. Include the affected version, reproduction using synthetic files only, expected and actual behavior, and impact. Do not include credentials, private source, customer data, or real translation resources.

## Safe use

- Review reports as untrusted input.
- Keep `.i18n-hunter` and `--include-values` reports on trusted local storage.
- Review `apply --dry-run` output.
- Do not run apply concurrently with other source-mutating tools.
- Commit or back up work before applying transformations.
