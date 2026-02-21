import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import-x";
import nodePlugin from "eslint-plugin-n";
import tseslint from "typescript-eslint";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";

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

  // TypeScript-specific rules
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      // return-await in try-catch for correct stack traces
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
    },
  },

  // Prettier must be LAST
  prettier,
);
