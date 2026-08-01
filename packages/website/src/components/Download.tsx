import type { ReactNode } from 'react'
import { DOWNLOAD } from '@/lib/downloads'
import { EXT_LINK } from '@/lib/links'
import { SECTIONS } from '@/lib/sections'
import { LinuxIcon, MacIcon, WindowsIcon } from './Icons'

type Platform = { icon: ReactNode; label: string; sub: string }

const PLATFORMS: Platform[] = [
  { icon: <MacIcon />, label: 'macOS', sub: '.dmg · Apple Silicon & Intel' },
  { icon: <WindowsIcon />, label: 'Windows', sub: '.exe · x64 & ARM64' },
  { icon: <LinuxIcon />, label: 'Linux', sub: '.AppImage · .deb · .rpm' }
]

export default function Download() {
  return (
    <section className="block" id={SECTIONS.download}>
      <div className="wrap">
        <div className="cta reveal">
          <div className="cta-glow" />
          <span className="kicker kicker--center">Source only</span>
          <h2>
            Public downloads are <span className="grad-text">not available yet</span>.
          </h2>
          <p>
            LeafBook is in active development. Build from the reviewed source until the first public
            release is published.
          </p>
          <div className="platforms">
            {PLATFORMS.map((p) => (
              <a className="plat" key={p.label} href={DOWNLOAD.source} {...EXT_LINK}>
                {p.icon}
                <div>
                  <b>{p.label}</b>
                  <span>Planned: {p.sub}</span>
                </div>
              </a>
            ))}
          </div>
          <div className="hero-note hero-note--cta">
            <span>No public LeafBook release or package-manager installation is available.</span>
          </div>
        </div>
      </div>
    </section>
  )
}
