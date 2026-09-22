import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const STAGING_REF = "xuvveqaizlletsqvwpgx";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

function assertStagingConfig(env: Record<string, string>): void {
  const url = env.VITE_STAGING_SUPABASE_URL?.trim();
  const key = env.VITE_STAGING_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !key) {
    throw new Error("Staging build requires staging-only Supabase URL and publishable key");
  }
  if (url !== STAGING_URL) {
    throw new Error(`Staging Supabase URL must target ${STAGING_REF}`);
  }
  if (key.startsWith("sb_secret_")) {
    throw new Error("Staging Supabase key must not be privileged");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
  } catch {
    throw new Error("Staging Supabase key must be a public JWT for the staging project");
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("role" in payload) ||
    payload.role !== "anon" ||
    !("ref" in payload) ||
    payload.ref !== STAGING_REF
  ) {
    throw new Error("Staging Supabase key must be a public JWT for the staging project");
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isStaging = mode === "staging";
  if (isStaging) {
    assertStagingConfig(loadEnv(mode, __dirname, "VITE_STAGING_"));
  }

  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: [
        ...(isStaging
          ? [{
              find: /^(?:@\/|(?:\.\.\/)+)integrations\/supabase\/client$/,
              replacement: path.resolve(__dirname, "./src/integrations/supabase/staging-client.ts"),
            }]
          : []),
        { find: "@", replacement: path.resolve(__dirname, "./src") },
      ],
    },
  };
});
