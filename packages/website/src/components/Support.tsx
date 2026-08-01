import { DOWNLOAD } from '@/lib/downloads'
import { EXT_LINK } from '@/lib/links'
import { SECTIONS } from '@/lib/sections'
import { HeartIcon } from './Icons'

export default function Support() {
  return (
    <section className="block" id={SECTIONS.support}>
      <div className="wrap">
        <div className="sec-head center reveal">
          <span className="kicker">Support</span>
          <h2 className="sec-title">Help validate LeafBook.</h2>
          <p className="sec-desc">
            Review the source and report issues while the first public release is being prepared.
          </p>
          <div className="hero-cta hero-cta--center">
            <a className="btn btn-primary btn-lg" href={DOWNLOAD.issues} {...EXT_LINK}>
              <HeartIcon />
              Report an issue
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
