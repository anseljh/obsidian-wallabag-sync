# Wallabag Sync

This is an [Obsidian](https://obsidian.md) plugin to sync your articles from Wallabag, an open-source read-it-later app, to your Obsidian vault.

## What it does

This is a really simple plugin. It does exactly one thing: it it syncs articles you've saved in Wallabag into your Obsidian Vault. It only does this when you tell it to, which you can do in two ways:

- Clicking the little newspaper icon in the ribbon, or
- By invoking the command "Wallabag Sync: Sync Wallabag articles" from the Command Palette.

## Sync everything instead of favorites

By default, Wallabag Sync only syncs articles you have **starred** in Wallabag. This is great if you save and read lots of articles in Wallabag, but only want some of them to end up in Obsidian.

However, if you want it to sync **everything**, go to the plugin settings, toggle the "Only sync starred articles" setting to off, click the "Reset sync" button, and then try syncing again.

Your first sync might take a while, especially if you're syncing everything. Hoewver, because the plugin keeps track of when you last synced, subsequent syncs should be fast.

## Similar work

- Huseyin Zengin's [obsidian-wallabag](https://github.com/huseyz/obsidian-wallabag/) plugin, no longer actively developed

## Developmment resources

- [Obsidian plugin developer documentation](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Wallabag documentation](https://doc.wallabag.org/)
- [Wallabag API documentation](https://app.wallabag.it/api/doc/)
