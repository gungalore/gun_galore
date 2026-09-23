// Community Guidelines — the feed-specific rules. Public and crawlable, like
// the AUP it sits beside.
//
// ⚠️ PUBLIC PAGE. Do NOT name restricted product categories or use the
// weapon vocabulary the public site deliberately avoids (see the header of
// ../acceptable-use/page.tsx). The feed is members-only; these rules are
// published so members (and anyone arriving from a shared link) know what is
// expected before they post.

import { SUPPORT_EMAIL } from '@/lib/brand';
import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Community Guidelines',
  description:
    'How the ALL Outdoor community feed works — what to share, what is not allowed, and how reporting works.',
};

export default function CommunityGuidelinesPage() {
  return (
    <>
      <LegalDocHeader
        title="Community Guidelines"
        lastUpdated="Effective 21 September 2026"
      />

      <h2>1. The community is members-only</h2>
      <p>
        The ALL Outdoor community is a space for signed-in members to share
        experiences, ask questions and discuss the outdoors. It sits behind
        your login: nothing you post is visible to signed-out visitors, and
        posts are not indexed by search engines. Shared links show a join
        screen, not your post, to anyone who is not signed in.
      </p>
      <p>
        These guidelines apply alongside our{' '}
        <a href="/acceptable-use" style={{ color: 'var(--red)' }}>
          Acceptable Use Policy
        </a>{' '}
        and our{' '}
        <a href="/terms" style={{ color: 'var(--red)' }}>Terms of Service</a>.
        Breaching them is a breach of the Terms.
      </p>

      <h2>2. What the community is for</h2>
      <ul>
        <li>Sharing trips, catches, builds and field experiences.</li>
        <li>Asking questions and giving advice.</li>
        <li>Gear reviews and honest, first-hand experience.</li>
        <li>General outdoor discussion — camping, fishing, overlanding and more.</li>
      </ul>

      <h2>3. No advertising or selling</h2>
      <p>
        The community is not a marketplace. <strong>Members may not post
        advertising or sales content of any kind</strong> — including:
      </p>
      <ul>
        <li>Links to your own shop, website, channel or storefront.</li>
        <li>Social-media handles, "DM me", "link in bio", or any request to take a conversation off the platform.</li>
        <li>Offers to sell, prices for sale, or "for sale" posts — even for your own ALL Outdoor listings.</li>
        <li>Watermarks or contact text baked into images.</li>
      </ul>
      <p>
        Selling happens through ALL Outdoor's own listing tools, not the feed.
        Official ALL Outdoor accounts may post announcements and features;
        those posts carry an <strong>Official</strong> badge.
      </p>

      <h2>4. Keep contact details off the feed</h2>
      <p>
        No phone numbers, email addresses, physical addresses, URLs, social
        handles or off-platform coordination in posts, comments or images.
        Keeping conversations on the platform is what makes them safe and
        moderatable.
      </p>

      <h2>5. Be decent</h2>
      <ul>
        <li>No hate speech, harassment, threats or discrimination.</li>
        <li>No doxxing or sharing another person's private information.</li>
        <li>No sexually explicit content.</li>
        <li>No content that is unlawful under South African law.</li>
        <li>No content that facilitates the sale of items that may not lawfully be sold.</li>
      </ul>

      <h2>6. Field and graphic photos</h2>
      <p>
        Field photography is part of hunting and fishing culture, and it is
        welcome here. We do apply a content warning: photos showing blood or
        field dressing are blurred until you choose to reveal them, and the
        most graphic images are hidden and reviewed by a moderator before they
        can appear. Post with consideration for other members.
      </p>

      <h2>7. How moderation works</h2>
      <p>
        Every post and comment is automatically screened before it is
        published. Anything the system cannot confidently clear is held for a
        human moderator rather than published. You can report a post or
        comment using the report control, and it will be reviewed.
      </p>

      <h2>8. Enforcement and reporting</h2>
      <p>
        We apply the enforcement ladder in the{' '}
        <a href="/acceptable-use" style={{ color: 'var(--red)' }}>
          Acceptable Use Policy
        </a>
        : remove, warn, suspend, or ban. To report community content, use the
        in-product report control, or email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        . You can appeal an enforcement decision within 14 days.
      </p>
    </>
  );
}
