# Changelog

## 0.3.1

- Group outlines are coloured: each covenant, clan or coterie gets a colour of
  its own, as a firmer outline with a faint wash inside. A group keeps its
  colour from map to map and is the same colour for every player, whichever
  groups they can see. The eight colours were checked to stay apart from one
  another, for colour-blind readers too; past eight groups they come round again.
- The group's name sits in the lower right corner, inside the outline, where it
  keeps clear of bond labels.
- The name no longer carries a count of the group's members.

## 0.3.0

- **Auto layout** (Arrange → Auto layout) replaces the old Network arrangement
  with one built for large casts. Characters are placed by how many bonds apart
  they are, crossed bonds are untangled, nobody is left standing on a bond that
  is not theirs, separate webs sit side by side and characters with no bonds
  wait in rows underneath. On an invented court of 90 it leaves 28 crossed
  bonds where Network left 46, and no portrait on a foreign bond where Network
  left 10.
- When outlines are on, Auto layout keeps each covenant, clan or coterie
  together on ground of its own: no outline overlaps another, and nobody
  stands inside an outline they do not belong to.
- Arrange → Covenants, Clans and Coteries now use the same engine, so they
  follow the bonds too instead of packing each group into a ring.
- A character with no covenant or clan no longer gets an "Unaligned" outline.
  They stand beside whoever they are bound to, which is where a ghoul or a
  touchstone belongs.
- Characters added with Cast or from a dossier are set down beside the people
  they are bound to, or near the middle of the view, and never on top of anyone.
- In Cards view, arrangements leave room for the wider cards, not the average one.
- A notice after each arrangement says how to undo it.

## 0.2.1

- Fixed: rank, clan, covenant, coterie, portrait and the sheet's "dead" box were
  read from the Actor in the sidebar, so anything typed into the sheet of an
  **unlinked** token never reached the map. The map and the dossier now read the
  token's own sheet, which is the one that opens when you double-click it.
- The dossier marks a character whose token on the map is unlinked, and its
  sheet button opens the same sheet the token does.

## 0.2.0

- Rank, bloodline and coterie are shown under each name, read from the character
  sheet: rank in gold, the bloodline in brackets after the clan, the coterie on
  its own line. Each can be switched off under Appearance.
- Coteries can be outlined (Appearance → Group outlines → By coterie) and
  gathered together (Arrange → Coteries).
- Statuses reworked for characters who are gone: Torpor, Missing, Left the City,
  Dead and Destroyed. Each has its own colour and shows as a boxed caption under
  the name, a badge, a drained portrait and, for the missing, a broken ring or,
  for the dead, a stroke through the portrait.
- Status is set with one click from the dossier, which also shows the status of
  everyone a character is tied to.
- A vampire whose sheet is marked dead now reads as Destroyed; other characters
  read as Dead. A character flagged "Final Death" in 0.1.0 now reads "Dead":
  re-flag them as Destroyed if that is what was meant.
- The dossier lists rank and coterie.
- API: `status.get(actorId)` and `status.set(actorId, status)`.

## 0.1.0

First release.

- Relationship-map scenes: gridless, dark, vision and fog off. Create one from
  the Scenes sidebar, the module settings, or convert an existing scene.
- Characters are ordinary tokens, drawn as round portraits (Constellation) or
  as portrait-and-name plates (Cards).
- Bonds between characters: 27 types across Blood, Loyalty, Feeling and Other,
  with colour, optional arrow, label, strength, key-tie mark, public notes and
  Storyteller-only notes.
- Ownership-driven visibility: characters follow Actor ownership; each bond
  has its own audience (everyone, Storyteller only, or chosen players).
- "See as a player" preview for Storytellers.
- Arrange tools: network, covenants, clans, lineage and circle, with undo.
- Dossier panel listing a character's ties, with quick visibility controls.
- Search, bond-type filters, hover highlighting, group outlines, patterned lines.
