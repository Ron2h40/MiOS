import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PhoneMockup } from "@/features/preview/PhoneMockup";

/**
 * A private, clickable mockup of the phone layout. It only shows when the
 * address carries the code set in MOCKUP_KEY; every other address is a normal
 * "not found". It uses made-up data and never reads or saves anyone's data.
 */
export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false },
};

export default function PreviewPage({ params }: PageProps<"/preview/[key]">) {
  return (
    <Suspense>
      <Gate params={params} />
    </Suspense>
  );
}

async function Gate({ params }: Pick<PageProps<"/preview/[key]">, "params">) {
  const { key } = await params;
  const expected = process.env.MOCKUP_KEY;
  if (!expected || key !== expected) notFound();
  return <PhoneMockup />;
}
