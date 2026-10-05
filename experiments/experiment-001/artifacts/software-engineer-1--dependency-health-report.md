# Dependency Health Report

This report provides a health assessment of the first-party dependencies in the AgentCraft-Genesis project by comparing their pinned versions against the latest versions available in the npm registry.

## Dependency Status Table

| Dependency | Pinned Version | Latest Version | Status |
|------------|---------------|---------------|--------|
| yaml | 2.9.1 | 2.9.1 | current |
| @a2a-js/sdk | 1.3.0 | 1.3.0 | current |
| @ag-ui/core | 1.0.1 | 1.0.2 | outdated |
| @modelcontextprotocol/sdk | 1.32.1 | 1.32.1 | current |
| @types/node | 24.19.1 | 26.6.4 | outdated |
| eslint | 10.12.0 | 10.12.0 | current |
| typescript | 5.9.3 | 7.0.2 | outdated |
| typescript-eslint | 8.71.0 | 8.71.0 | current |
| vitest | 5.0.3 | 5.0.3 | current |
| zod | 4.6.5 | 4.6.5 | current |

## Recommendations

### Outdated Dependencies

- **@ag-ui/core (1.0.1 → 1.0.2)**: Update to the latest version to benefit from bug fixes and improvements.
- **@types/node (24.19.1 → 26.6.4)**: Update to align with the latest Node.js features and TypeScript definitions. Consider compatibility with your current Node.js version.
- **typescript (5.9.3 → 7.0.2)**: Update to the latest version for improved language features, better performance, and enhanced tooling support. Ensure compatibility with your project's dependencies.

### Current Dependencies

All other dependencies are current and do not require updates at this time.