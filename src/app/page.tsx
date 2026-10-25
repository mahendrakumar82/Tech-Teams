import { Suspense } from "react";
import { BeforeWeDecide } from "@/components/before-we-decide";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<BeforeWeDecide />}>
      <SampledApp searchParams={searchParams} />
    </Suspense>
  );
}

async function SampledApp({
  searchParams,
}: {
  searchParams: PageProps<"/">["searchParams"];
}) {
  const query = await searchParams;
  const sample = query.sample;
  const startWithSample = sample === "1" || (Array.isArray(sample) && sample.includes("1"));
  return <BeforeWeDecide startWithSample={startWithSample} />;
}
