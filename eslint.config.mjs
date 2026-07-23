import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Next.js 16 removed `next lint`; lint via ESLint 9 flat config using the Next
// plugin's flat configs directly (the FlatCompat bridge is incompatible with
// eslint-config-next under ESLint 9).
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.recommended],
    plugins: { "@next/next": next, "react-hooks": reactHooks },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
      // Classic react-hooks rules only (registers the plugin so inline disables
      // resolve). The stricter react-hooks v6 additions are intentionally left
      // off to avoid flagging established patterns across the existing codebase.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Boundary/eval/smoke code uses flexible typing at external edges; keep
      // these visible without failing CI.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
