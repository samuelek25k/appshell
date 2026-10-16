# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| main (latest) | :white_check_mark: |
| < 0.1.0 | :x: |

## Reporting a Vulnerability

We take the security of Appshell seriously. If you discover a security vulnerability, please do NOT disclose it publicly in an issue or pull request.

Instead, please report security issues through **GitHub Private Vulnerability Reporting** on this repository:
1. Navigate to the **Security** tab of the repository.
2. Select **Advisories** and click **Report a vulnerability**.
3. Provide detailed steps to reproduce the issue, including an exploit scenario if possible.

If private vulnerability reporting is unavailable, contact the project maintainers directly.

### What to Expect

- **Acknowledgment**: Within 48 hours.
- **Assessment**: We will validate the issue against Appshell isolation and capability contracts.
- **Coordination**: We follow coordinated disclosure. We will work with you on a fix and disclosure timeline (standard 90 days).
- **Credit**: We will credit you in the security advisory and release notes (unless you request anonymity).

## Security Principles

1. **Third-party app code is adversarial.** Core apps get no exemption. Never give app code Node, host IPC or another app's origin.
2. **Honest guarantees.** Never document protection the code does not enforce and a test does not prove.
3. Every sandbox boundary is validated deterministically by the hostile-app test gate (`test/e2e/hostile.test.js`).
