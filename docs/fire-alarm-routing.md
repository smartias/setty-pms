# Fire Alarm routing rule (knowledge mining and sorting)

Requested by the tech directors (Nov 2026). Applies to Project Knowledge, Best
Practices, Engineering Standards and Agency Preferences.

The classifier that sorts mined items into disciplines does not live in this
repo. Paste this into it, and use the same text when a person or Claude files an
item through `save_knowledge`:

> Route any incoming item that mentions the terms below to the Fire Alarm
> discipline, Division 28 (28 31 00 Fire Detection and Alarm): fire alarm
> control panel or FACP, notification appliance (horn, strobe, speaker), smoke
> or heat detector, manual pull station, addressable device or initiating device
> circuit, NFPA 72, duct detector, fire alarm shop drawings or battery
> calculations, annunciator panel, and fire alarm monitoring. Items that only
> cover sprinklers, standpipes, or fire pumps stay with Fire Protection,
> Division 21. If the discipline cannot be determined, default to Fire
> Protection.

The same terms drive the "Possible Fire Alarm (not yet tagged)" filter in
`SettyIntelligence.html` (`FIRE_ALARM_RE`). Keep the two lists in step.

Database: migration `20261118120000_fire_alarm_discipline.sql` stops
`pms_norm_discipline` from folding "Fire Alarm" into "Fire Protection". An item
that belongs to both trades carries both in `disciplines`.
