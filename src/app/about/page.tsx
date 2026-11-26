import type { Metadata } from "next";
import { GAME_FACTS } from "@/components/home/home-data";
import { LEAD, READ, SiteIntro, SitePage, SiteSection } from "@/components/home/SitePage";
import { SITE_NAME } from "@/lib/site";

const DESCRIPTION = "Offline open-source 500 Hz racing simulator adapted from LibreCorsa.";

export const metadata: Metadata = {
  title: `About | ${SITE_NAME}`,
  description: DESCRIPTION,
};

export default function AboutPage() {
  return (
    <SitePage>
      <SiteIntro title={`About ${SITE_NAME} Offline`}>
        <p className={LEAD}>
          {SITE_NAME} Offline is a standalone, 100% offline adaptation of the open-source LibreCorsa motorsport
          simulator. Drive hot laps, race full AI grids, tune setups in the garage, and race local ghosts with zero
          internet access required.
        </p>
      </SiteIntro>

      <SiteSection id="game" title="What is in it">
        <dl className="m-0 flex max-w-[68ch] flex-col">
          {GAME_FACTS.map(([label, text]) => (
            <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-5 border-t border-lc-line py-3.5 max-sm:grid-cols-1 max-sm:gap-y-1">
              <dt className="lc-lbl pt-0.5">{label}</dt>
              <dd className="lc-body m-0 text-[16px] text-lc-chalk">{text}</dd>
            </div>
          ))}
        </dl>
      </SiteSection>

      <SiteSection id="offline" title="Offline storage">
        <p className={READ}>
          All online services (multiplayer rooms, scheduled races, cloud accounts, remote leaderboards, telemetry
          heartbeats, and update checks) are removed. Every setting, car setup, best lap, ghost recording, and race
          history entry stays strictly on your device.
        </p>
      </SiteSection>
    </SitePage>
  );
}
