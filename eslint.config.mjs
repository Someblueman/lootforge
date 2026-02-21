import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import nodePlugin from "eslint-plugin-n";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Global ignores
  { ignores: ["dist/", "coverage/", "node_modules/", "scripts/"] },

  // Base JS recommended
  eslint.configs.recommended,

  // TypeScript strict + stylistic (type-checked)
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Parser config with projectService
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Node.js rules (ESM project)
  nodePlugin.configs["flat/recommended-module"],

  // Import plugin
  {
    plugins: { "import-x": importPlugin },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
    rules: {
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", ["parent", "sibling", "index"]],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import-x/no-duplicates": "error",
      "import-x/consistent-type-specifier-style": ["error", "prefer-inline"],
    },
  },

  // TypeScript-specific rules (all files)
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      // no-import-type-side-effects intentionally omitted; consistent-type-imports
      // with inline-type-imports handles the same concern without conflicting.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Type-checked rules (src only -- tests don't have tsconfig coverage)
  {
    files: ["src/**/*.ts"],
    rules: {
      // Allow numbers in template literals (safe and common in this codebase)
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowNever: true },
      ],
      // return-await in try-catch for correct stack traces
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
    },
  },

  // Disable type-checked rules for test files (not in tsconfig.json)
  // Must come AFTER all other configs so it properly overrides
  {
    files: ["test/**/*.ts"],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "n/no-unpublished-import": "off",
      // Relax strict rules that conflict with common test patterns
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },

  // Prettier must be LAST
  prettier,
);
