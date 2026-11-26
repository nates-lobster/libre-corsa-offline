import type { Metadata } from "next";
import { TrackGate } from "@/components/TrackGate";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Play | ${SITE_NAME}`,
  description: SITE_DESCRIPTION,
};

/** The simulator itself. Runs 100% offline with local storage and bundled assets. */
export default function PlayPage() {
  return (
    <main className="h-dvh w-screen overflow-hidden bg-lc-void">
      <h1 className="sr-only">Play LibreCorsa Offline: open-source 500 Hz racing simulator</h1>
      <p className="sr-only">{SITE_DESCRIPTION}</p>
      <TrackGate />
    </main>
  );
}
