import { HomeShell } from "@/components/home-shell";

type HomePageProps = {
  searchParams: Promise<{
    authError?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const authError = Array.isArray(params.authError)
    ? params.authError[0] ?? null
    : params.authError ?? null;

  return <HomeShell initialAuthError={authError} />;
}
