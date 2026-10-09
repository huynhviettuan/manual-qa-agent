export * from './executor.ts';

/** `QA_SECRET_<NAME>` environment variables; replace with a vault-backed resolver in production. */
export function envSecretResolver(env: NodeJS.ProcessEnv = process.env) {
  return (name: string) => env[`QA_SECRET_${name}`] || undefined;
}
