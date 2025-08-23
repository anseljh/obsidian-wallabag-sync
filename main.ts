import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import TurndownService from 'turndown';
import { PermaAPI } from "@harvard-lil/perma-js-sdk";

const PLUGIN_NAME = 'Wallabag Sync';
const DEBUG = false; // Set to true to enable debug logging

function debugLog(message: string) {
	if (DEBUG) {
		console.log(message);
	}
}

interface WallabagSyncSettings {
	// user-visible settings:
	noteFolder: string;
	instanceUrl: string;
	clientId: string;
	clientSecret: string;
	username: string;
	password: string;
	onlyStarred: boolean; // whether to only sync starred articles
	permaAPIKey: string; // optional Perma.cc API key
	// hidden settings:
	accessToken: string;
	refreshToken: string;
	tokenExpiry: number; // Unix timestamp
	since: number; // Unix timestamp of last sync
}

const DEFAULT_SETTINGS: Partial<WallabagSyncSettings> = {
	instanceUrl: 'https://app.wallabag.it',
	noteFolder: 'Wallabag',
	onlyStarred: true,
	since: 0, // default to 0 for no articles synced
}

export default class WallabagSyncPlugin extends Plugin {
	settings: WallabagSyncSettings;
	turndownService: TurndownService;
	permaAPI: any;

	async onload() {
		debugLog(`Loading plugin ${PLUGIN_NAME}...`)
		await this.loadSettings();

		this.addCommand({
			id: 'sync-wallabag-articles',
			name: 'Sync Wallabag articles',
			callback: () => this.syncWallabagArticles()
		});
		this.addRibbonIcon('newspaper', 'Sync Wallabag', () => {
			this.syncWallabagArticles();
		});

		this.addCommand({
			id: 'add-permalink',
			name: 'Add permalink to this article',
			callback: () => this.addPermalink()
		})
		this.addRibbonIcon('infinity', 'Add Perma link', () => {
			this.addPermalink();
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new WallabagSyncSettingTab(this.app, this));

		// Init Turndown for converting HTML to Markdown
		this.turndownService = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced' });

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	console.log('click', evt);
		// });

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

		debugLog(`Finished loading plugin ${PLUGIN_NAME}.`)
	}

	onunload() {
		// Add these back in when the method does something:
		// debugLog(`Unloading plugin ${PLUGIN_NAME}...`)
		// debugLog(`Finished unloading plugin ${PLUGIN_NAME}.`)
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async authenticate(): Promise<void> {
		const { instanceUrl, clientId, clientSecret, username, password } = this.settings;
		if (!instanceUrl || !clientId || !clientSecret || !username || !password) {
			new Notice('Please fill in all Wallabag credentials in the settings.');
			throw new Error('Missing credentials');
		}
		new Notice('Authenticating with Wallabag...');
		const url = `${instanceUrl}/oauth/v2/token`;
		const body = new URLSearchParams({
			grant_type: 'password',
			client_id: clientId,
			client_secret: clientSecret,
			username,
			password
		});
		const resp = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body
		});
		if (!resp.ok) {
			new Notice('Failed to authenticate with Wallabag.');
			throw new Error(await resp.text());
		}
		const data = await resp.json();
		this.settings.accessToken = data.access_token;
		this.settings.refreshToken = data.refresh_token;
		this.settings.tokenExpiry = Date.now() + (data.expires_in * 1000);
		await this.saveSettings();
	}

	async ensureTokenValid(): Promise<void> {
		if (!this.settings.accessToken || Date.now() > this.settings.tokenExpiry - 60 * 1000) {
			await this.authenticate();
		}
	}

	async syncWallabagArticles() {
		try {
			await this.ensureTokenValid();
			const articles = await this.fetchArticles();

			const folderPath = this.settings.noteFolder || 'Wallabag';
			await this.ensureFolderExists(folderPath);

			for (const article of articles) {
				await this.createOrUpdateArticleNote(article, folderPath);
			}
			new Notice(`Synced ${articles.length} Wallabag articles.`);
		} catch (e) {
			console.error(e);
			new Notice('Sync failed. See console for details.');
		}
	}

	async fetchArticles(): Promise<unknown[]> {
		const { instanceUrl, accessToken, since } = this.settings;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, prefer-const
		let articles: any[] = [];
		let page = 1;
		let hasMore = true;
		const newSince = Date.now() / 1000;

		new Notice('Fetching Wallabag articles...');
		while (hasMore) {
			let wbURL = `${instanceUrl}/api/entries.json?since=${since}&page=${page}&perPage=30`
			if (this.settings.onlyStarred) { wbURL += '&starred=1'; }
			const resp = await fetch(wbURL, {
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			if (!resp.ok) throw new Error(`Failed to fetch articles: ${await resp.text()}`);
			const data = await resp.json();
			articles.push(...(data._embedded?.items || []));
			if (data._links?.next) page++;
			else hasMore = false;
		}
		this.settings.since = newSince;
		await this.saveSettings();
		return articles;
	}

	async createOrUpdateArticleNote(article: any, folder: string) {
		const vault = this.app.vault;
		const sanitizedTitle = article.title.replace(/[\\/:*?"<>|]/g, '-');
		const fileName = `${sanitizedTitle}.md`;
		const filePath = `${folder}/${fileName}`;
		const noteContent = this.articleToMarkdown(article);

		const existing = vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			await vault.modify(existing, noteContent);
		} else {
			await vault.create(filePath, noteContent);
		}
	}

	articleToMarkdown(article: any): string {
		return `---
url: ${article.url}
tags: ${(article.tags || []).map((t: any) => t.label.replace(' ', '-')).join(', ')}
created_at: ${article.created_at}
wallabag id: ${article.id}
---

# ${article.title}

${article.content ? this.turndownService.turndown(article.content) : ''}
`;
	}

	async ensureFolderExists(folder: string) {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(folder))) {
			await adapter.mkdir(folder);
		}
	}

	initPermaAPI() {
		// Init Perma API client (if API key is set)
		if (this.settings.permaAPIKey && this.settings.permaAPIKey !== '') {
			debugLog("Initializing Perma.cc API client.")
			this.permaAPI = new PermaAPI(this.settings.permaAPIKey)
		} else {
			debugLog("No Perma.cc API key set; skipping initialization.")
		}
	}

	addPermalinkProperty(file: TFile, permaLink: string) {
		this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.permalink = permaLink;
			debugLog("Added permalink to frontmatter.");
			debugLog(`Frontmatter: ${frontmatter}`);
		});
	}

	addPermalink() {
		debugLog("Adding Perma.cc link for current note.")

		// Initialize Perma API if needed
		if (!this.permaAPI) {
			this.initPermaAPI();
			if (!this.permaAPI) {
				new Notice("Perma.cc API could not initialize. Please set your API key in the plugin settings.");
				return;
			}
		}

		// Get the current note file
		const file = this.app.workspace.getActiveFile();
		if (file instanceof TFile) {
			let sourceUrl: string | null = null;
			
			// https://docs.obsidian.md/Reference/TypeScript+API/FileManager/processFrontMatter
			debugLog("Before processFrontMatter()");
			this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				debugLog(`Frontmatter: ${frontmatter}`);

				if (frontmatter && 'url' in frontmatter) {
					sourceUrl = frontmatter.url;
					debugLog(`Found source URL in frontmatter: ${sourceUrl}`);
				}

				if (sourceUrl && sourceUrl !== '') {
					debugLog(`**Source URL: ${sourceUrl}**`);
				}

				// const archive = { guid: "TEST1234" }; // Mock result for testing
				debugLog("Before createArchive() call.");
				this.permaAPI.createArchive(sourceUrl).then(async (archive: any) => {

					// 	// Notify that archive was created.
					debugLog("Perma.cc archive created: " + JSON.stringify(archive));
					new Notice(`Perma.cc link created: ${archive.guid}`);
					
					const permaLink = `https://perma.cc/${archive.guid}`;
					this.addPermalinkProperty(file, permaLink);
				}).catch((error: Error) => {
					console.error("Error creating Perma.cc archive: " + error);
					new Notice("Error creating Perma.cc archive.");
				});
				debugLog("After createArchive() call.");

			});
			debugLog("After processFrontMatter()");
		}
	}

}

class WallabagSyncSettingTab extends PluginSettingTab {
	plugin: WallabagSyncPlugin;

	constructor(app: App, plugin: WallabagSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Folder for Wallabag notes')
			.setDesc('Synced articles will appear as notes here.')
			.addText(text => text
				.setValue(this.plugin.settings.noteFolder || 'Wallabag')
				.onChange(async (value) => {
					this.plugin.settings.noteFolder = value.trim() || 'Wallabag';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Only sync starred articles')
			.setDesc('Toggle this off to sync all articles.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.onlyStarred)
				.onChange(async (value) => {
					this.plugin.settings.onlyStarred = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		new Setting(containerEl).setName('Server and authentication').setHeading();

		containerEl.createEl('span', { text: 'Create a new client in your ' });
		containerEl.createEl('a', { href: "https://app.wallabag.it/developer", text: "Wallabag account settings" });
		containerEl.createEl('span', { text: '.' });

		new Setting(containerEl)
			.setName('Wallabag server URL')
			.setDesc('Where is your Wallabag instance?')
			.addText(text => text
				.setPlaceholder('Enter URL')
				.setValue(this.plugin.settings.instanceUrl)
				.onChange(async (value) => {
					this.plugin.settings.instanceUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('OAuth client ID')
			.setDesc('Your Wallabag OAuth client ID')
			.addText(text => text
				.setValue(this.plugin.settings.clientId || '')
				.onChange(async (value) => {
					this.plugin.settings.clientId = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('OAuth Client secret')
			.setDesc('Your Wallabag OAuth client secret')
			.addText(text => text
				.setPlaceholder('Enter OAuth client secret')
				.setValue(this.plugin.settings.clientSecret || '')
				.onChange(async (value) => {
					this.plugin.settings.clientSecret = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Wallabag username')
			.setDesc('Your Wallabag username')
			.addText(text => text
				.setValue(this.plugin.settings.username || '')
				.onChange(async (value) => {
					this.plugin.settings.username = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Wallabag password')
			.setDesc('Your Wallabag password (stored locally)')
			.addText(text => text
				.setValue(this.plugin.settings.password || '')
				.onChange(async (value) => {
					this.plugin.settings.password = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName('Permanent archiving').setHeading();

		new Setting(containerEl)
			.setName('Perma.cc API key')
			.setDesc('Your API key for the Perma.cc archiving service (stored locally)')
			.addText(text => {
				text.setValue(this.plugin.settings.permaAPIKey || '')
				.onChange(async (value) => {
					this.plugin.settings.permaAPIKey = value.trim();
					await this.plugin.saveSettings();
				});
				text.inputEl.type = 'password';
			});

		new Setting(containerEl).setName('Danger zone').setHeading().setClass('danger');

		new Setting(containerEl)
			.setName('Reset sync memory')
			.setClass('danger')
			.setDesc('This will reset the last-sync timestamp and force a full resync of all articles.')
			.addButton(resetSyncButton => resetSyncButton
				.setButtonText('Reset sync')
				.onClick(async () => {
					this.plugin.settings.since = 0;
					await this.plugin.saveSettings();
					new Notice('Sync memory reset.');
				}))

	}
}
