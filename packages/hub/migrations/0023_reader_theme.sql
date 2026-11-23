-- The light or dark look a person picked for the hub pages and the viewer; null follows their system.
alter table users add column theme text check (theme in ('light', 'dark'));
