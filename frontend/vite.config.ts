import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function optimizeLucideImports(): Plugin {
  let iconMap: Record<string, string> | null = null;

  function loadIconMap() {
    if (iconMap) return iconMap;
    iconMap = {};
    try {
      const lucidePkg = require.resolve("lucide-react/package.json");
      const lucideEntry = path.join(path.dirname(lucidePkg), "dist", "esm", "lucide-react.js");
      const content = fs.readFileSync(lucideEntry, "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^export \{ (.*) \} from '(\.\/icons\/[^']+)';$/);
        if (match) {
          const list = match[1].split(",");
          const file = match[2];
          for (const item of list) {
            const parts = item.trim().split(/\s+as\s+/);
            const exportName = parts[parts.length - 1].trim();
            iconMap[exportName] = path.posix.join("lucide-react/dist/esm", file);
          }
        }
      }
    } catch (e) {
      console.warn("Could not load lucide icon map:", e);
    }
    return iconMap;
  }

  return {
    name: "vite-plugin-optimize-lucide",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".tsx") && !id.endsWith(".ts")) return null;
      if (!code.includes("lucide-react")) return null;

      const map = loadIconMap();
      if (!map || Object.keys(map).length === 0) return null;

      const lucideImportRegex = /import\s+\{([^}]+)\}\s+from\s+["']lucide-react["'];?/g;
      let hasChanges = false;

      const newCode = code.replace(lucideImportRegex, (match, importsStr) => {
        const items = importsStr.split(",").map((s) => s.trim()).filter(Boolean);
        const directImports: string[] = [];
        const fallbackImports: string[] = [];

        for (const item of items) {
          if (item.startsWith("type ")) {
            fallbackImports.push(item);
            continue;
          }
          const parts = item.split(/\s+as\s+/);
          const iconName = parts[0].trim();
          const localAlias = parts[1] ? parts[1].trim() : iconName;

          if (map[iconName]) {
            directImports.push(`import ${localAlias} from "${map[iconName]}";`);
          } else {
            fallbackImports.push(item);
          }
        }

        if (directImports.length > 0) {
          hasChanges = true;
          let result = directImports.join("\n");
          if (fallbackImports.length > 0) {
            result += `\nimport { ${fallbackImports.join(", ")} } from "lucide-react";`;
          }
          return result;
        }

        return match;
      });

      return hasChanges ? { code: newCode, map: null } : null;
    },
  };
}

export default defineConfig({
  plugins: [optimizeLucideImports(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("recharts")) {
              return "vendor-recharts";
            }
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
