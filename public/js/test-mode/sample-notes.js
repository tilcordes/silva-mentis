// Sample notes for the test version: daily notes with tasks for future days, book notes with
// metadata, a Mindfulness page with linked and unlinked references, a weekly plan, a person page.
// Dates are relative to today, so the stream always looks alive.

import { addDays, formatDailyTitle } from '../core/dates.js';
import { createBlock } from '../core/outline.js';

/** A block with children: b('text', b('child')). */
function b(text, ...children) {
  return createBlock(text, children);
}

/** "[[October 23rd, 2026]]" for a day relative to today. */
function day(offset) {
  return `[[${formatDailyTitle(addDays(new Date(), offset))}]]`;
}

function dayTitle(offset) {
  return formatDailyTitle(addDays(new Date(), offset));
}

function weekPlanTitle() {
  const today = new Date();
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const sunday = addDays(monday, 6);
  const month = (date) => date.toLocaleString('en', { month: 'short' });
  const range = monday.getMonth() === sunday.getMonth()
    ? `${month(monday)} ${monday.getDate()} – ${sunday.getDate()}`
    : `${month(monday)} ${monday.getDate()} – ${month(sunday)} ${sunday.getDate()}`;
  return `Weekly Plan: ${range}`;
}

/** @returns {Array<{title: string, blocks: object[], shortcut?: boolean, updated?: number}>} */
export function sampleNotes() {
  const now = Date.now();
  const hoursAgo = (hours) => now - hours * 3_600_000;
  const week = weekPlanTitle();

  return [
    {
      title: dayTitle(0),
      blocks: [
        b('[x] Book train tickets for the [[Lisbon Trip]]'),
        b('Tried my new [[Running Shoes]], ran 8 km along the river with a lot less [[Knee Pain]]. Could be that the old pair caused it. #Running'),
        b(day(3),
          b('[ ] Finish the draft of [[Article: Why I Take Notes]]'),
          b('[ ] Ask [[Mara Lindqvist]] about the workshop dates')),
        b('Read chapter 3 of [[Waking Up]]: ==how we pay attention determines the quality of our lives==',
          b('Compare with what [[Cal Newport]] says about solitude in [[Digital Minimalism]]')),
        b('Ideas for the next [[Monday Letter]]',
          b('The [[Zettelkasten]] myth: links matter more than boxes'),
          b('Reading notes as a #[[Second Brain]]')),
        b(`Coffee with [[Jonas Weber]]. He recommended [[The Shallows]], check in again on ${day(14)}`),
      ],
    },
    {
      title: dayTitle(-1),
      updated: hoursAgo(26),
      blocks: [
        b('Morning pages: felt scattered, too many tabs open. #Attention'),
        b('Saved the article [[Article: Building a Second Brain]] #BASB #[[Tiago Forte]]'),
        b(`[ ] Call the [[Dentist]] about the crown ${day(0)}`),
      ],
    },
    {
      title: dayTitle(-3),
      updated: hoursAgo(74),
      blocks: [
        b('Finished [[Zen Mind, Beginner\'s Mind]]. Short book, slow reading.'),
        b('Met [[Mara Lindqvist]] at the studio. She runs the [[Studio North]] workshops.',
          b('Wants to do something on #[[Note-taking]] in spring')),
        b('[x] Send the offer to [[Studio North]] #[[Outbound Sales]]'),
      ],
    },
    {
      title: dayTitle(-6),
      updated: hoursAgo(146),
      blocks: [
        b('Started [[The Shallows]] — the chapter on the [[Tech Addiction]] loop is uncomfortable reading.'),
        b('#Running 5 km, knee hurt after 3. Maybe the [[Running Shoes]]?'),
      ],
    },
    {
      title: 'Mindfulness',
      updated: hoursAgo(50),
      shortcut: false,
      blocks: [
        b('Practice notes live on [[Meditation]]. This page collects what I read about it.'),
        b('Open question: is ==attention a skill or a habit==? #[[Open Questions]]'),
      ],
    },
    {
      title: 'Waking Up',
      updated: hoursAgo(5),
      blocks: [
        b('Metadata::',
          b('Author:: [[Sam Harris]]'),
          b('Type:: #Books'),
          b('Recommended By:: [[Jonas Weber]]'),
          b('Tags:: #Mindfulness #Meditation #Psychology #Happiness')),
        b('Notes',
          b('Consciousness is the one thing in this universe that cannot be an illusion.'),
          b('**Meditation is a tool for ==noticing== thoughts before they carry you away.**'),
          b('Happiness is not found by rearranging the contents of experience. #Happiness')),
      ],
    },
    {
      title: 'The Shallows',
      updated: hoursAgo(140),
      blocks: [
        b('Metadata::',
          b('Author:: [[Nicholas Carr]]'),
          b('Type:: #Books'),
          b('Tags:: #Attention #[[Tech Addiction]] #Mindfulness')),
        b('Notes',
          b('The Net seizes our attention only to scatter it.'),
          b('Deep reading is a form of [[Meditation]] for the page.')),
      ],
    },
    {
      title: 'Zen Mind, Beginner\'s Mind',
      updated: hoursAgo(72),
      blocks: [
        b('Metadata::',
          b('Author:: [[Shunryu Suzuki]]'),
          b('Type:: #Books'),
          b('Tags:: #Zen #Mindfulness #Buddhism')),
        b('Notes', b('In the beginner\'s mind there are many possibilities, in the expert\'s mind there are few.')),
      ],
    },
    {
      title: 'Digital Minimalism',
      updated: hoursAgo(90),
      blocks: [
        b('Metadata::',
          b('Author:: [[Cal Newport]]'),
          b('Type:: #Books'),
          b('Tags:: #Attention #[[Social Media]] #Happiness')),
        b('Notes',
          b('Chapter 4',
            b('Solitude is a precondition for [[Mindfulness]], not a reward for it. **Schedule it.**'))),
      ],
    },
    {
      title: '10% Happier',
      updated: hoursAgo(300),
      blocks: [
        b('Metadata::',
          b('Author:: [[Dan Harris]]'),
          b('Type:: #Books'),
          b('Tags:: #Happiness #Meditation')),
        b('Notes',
          b('What mindfulness does is create some space in your head, so you can respond instead of react.'),
          b('Self-compassion is not self-indulgence.')),
      ],
    },
    {
      title: 'Article: Buddhism Scholars on Attention',
      updated: hoursAgo(400),
      blocks: [
        b('Metadata::', b('Type:: #Articles'), b('Tags:: #Buddhism #Attention')),
        b('Notes',
          b('Early texts treat mindfulness as remembering, not as calm.'),
          b('Modern mindfulness programs dropped the ethical frame.'),
          b('Scholars disagree whether mindfulness can be taught without it.')),
      ],
    },
    {
      title: 'Article: Why I Take Notes',
      updated: hoursAgo(20),
      blocks: [
        b('Metadata::',
          b(`Target Date:: ${day(3)}`),
          b('Status:: #drafting'),
          b('Tags:: #Writing #Attention')),
        b('Why linking beats filing',
          b('Pages live nowhere and everywhere'),
          b('**Every page is a tag, and every tag is a page**')),
      ],
    },
    {
      title: 'Mara Lindqvist',
      updated: hoursAgo(70),
      blocks: [
        b('Metadata::',
          b('Email:: mara@example.com'),
          b('Company:: [[Studio North]]'),
          b('Role:: Workshop lead'),
          b('How We Met:: Design meetup in Malmö'),
          b('Interests:: #[[Note-taking]] #Typography'),
          b('Tags:: #People')),
      ],
    },
    {
      title: week,
      shortcut: true,
      updated: hoursAgo(3),
      blocks: [
        b('Top weekly goals',
          b('[ ] Publish [[Article: Why I Take Notes]]'),
          b('[x] Send the offer to [[Studio North]] #[[Outbound Sales]]'),
          b('[ ] Plan the budget for the [[Lisbon Trip]]')),
        b('Daily goals',
          b(day(0), b('[ ] Prepare the slides for [[Art Direction]]')),
          b(day(1), b('[ ] Review the [[Monday Letter]] draft'))),
      ],
    },
    {
      title: 'Projects',
      shortcut: true,
      blocks: [
        b('[[Article: Why I Take Notes]] #Writing'),
        b('[[Lisbon Trip]] #Travel'),
        b('[[Studio North]] workshop #[[Outbound Sales]]'),
      ],
    },
    {
      title: 'Areas',
      shortcut: true,
      blocks: [b('#Writing'), b('#Health', b('[[Running]] and [[Knee Pain]]')), b('#People'), b('#Travel')],
    },
    { title: 'Short-term Goals', shortcut: true, blocks: [b('Run a half marathon without [[Knee Pain]] #Running'), b('Publish two articles a month #Writing')] },
    { title: 'Long-term Goals', shortcut: true, blocks: [b('Write a book about [[Note-taking]]'), b('Meditate daily for a year #Meditation')] },
  ];
}
