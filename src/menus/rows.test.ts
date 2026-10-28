import assert from "node:assert/strict";
import test from "node:test";
import { rows as barrelRows, titleFor } from "../menus.ts";
import { defaultSettings, type Settings } from "./model.ts";
import { rows } from "./rows.ts";
import {
  EMPTY_MENU_DATA,
  type Frame,
  type MenuData,
  type Row,
  type ScreenId,
} from "./types.ts";

const UNDEFINED = "\u0000undefined";

type Fixture = {
  name: string;
  id: ScreenId;
  index: number;
  param?: string;
  title?: string;
  omitData?: boolean;
  settings?: Partial<Settings>;
  data?: Partial<MenuData>;
  rows: Row[];
};

function revive(value: unknown): unknown {
  if (value === UNDEFINED) return undefined;
  if (Array.isArray(value)) return value.map(revive);
  if (value !== null && typeof value === "object") {
    const revived: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) revived[key] = revive(entry);
    return revived;
  }
  return value;
}

const FIXTURES = [
  "{\"name\":\"main default argument\",\"id\":\"main\",\"index\":4,\"omitData\":true,\"rows\":[{\"id\":\"playlists\",\"title\":\"Playlists\",\"action\":\"open\",\"screen\":\"playlists\"},{\"id\":\"artists\",\"title\":\"Artists\",\"action\":\"open\",\"screen\":\"artists\"},{\"id\":\"songs\",\"title\":\"Songs\",\"action\":\"open\",\"screen\":\"songs\"},{\"id\":\"settings\",\"title\":\"Settings\",\"action\":\"open\",\"screen\":\"settings\"}]}",
  "{\"name\":\"main empty\",\"id\":\"main\",\"index\":0,\"rows\":[{\"id\":\"playlists\",\"title\":\"Playlists\",\"action\":\"open\",\"screen\":\"playlists\"},{\"id\":\"artists\",\"title\":\"Artists\",\"action\":\"open\",\"screen\":\"artists\"},{\"id\":\"songs\",\"title\":\"Songs\",\"action\":\"open\",\"screen\":\"songs\"},{\"id\":\"settings\",\"title\":\"Settings\",\"action\":\"open\",\"screen\":\"settings\"}]}",
  "{\"name\":\"main now playing\",\"id\":\"main\",\"index\":1,\"data\":{\"nowPlaying\":{\"title\":\"Song\",\"artistName\":\"A\"}},\"rows\":[{\"id\":\"playlists\",\"title\":\"Playlists\",\"action\":\"open\",\"screen\":\"playlists\"},{\"id\":\"artists\",\"title\":\"Artists\",\"action\":\"open\",\"screen\":\"artists\"},{\"id\":\"songs\",\"title\":\"Songs\",\"action\":\"open\",\"screen\":\"songs\"},{\"id\":\"settings\",\"title\":\"Settings\",\"action\":\"open\",\"screen\":\"settings\"},{\"id\":\"now-playing\",\"title\":\"Now Playing\",\"action\":\"open\",\"screen\":\"now-playing\"}]}",
  "{\"name\":\"playlists empty\",\"id\":\"playlists\",\"index\":0,\"rows\":[{\"id\":\"no-music\",\"title\":\"No Music\",\"action\":\"info\",\"centered\":true}]}",
  "{\"name\":\"playlists duplicate ids\",\"id\":\"playlists\",\"index\":0,\"data\":{\"playlists\":[{\"id\":\"p1\",\"name\":\"Mix\",\"count\":2},{\"id\":\"p1\",\"name\":\"Dup\",\"count\":1}]},\"rows\":[{\"id\":\"p1\",\"title\":\"Mix\",\"action\":\"open\",\"screen\":\"playlist\",\"param\":\"p1\"},{\"id\":\"p1\",\"title\":\"Dup\",\"action\":\"open\",\"screen\":\"playlist\",\"param\":\"p1\"}]}",
  "{\"name\":\"artists empty\",\"id\":\"artists\",\"index\":0,\"rows\":[{\"id\":\"no-music\",\"title\":\"No Music\",\"action\":\"info\",\"centered\":true}]}",
  "{\"name\":\"artists without songs omits All\",\"id\":\"artists\",\"index\":0,\"data\":{\"artists\":[{\"id\":\"ar1\",\"name\":\"Ada\",\"count\":0}]},\"rows\":[{\"id\":\"ar1\",\"title\":\"Ada\",\"action\":\"open\",\"screen\":\"artist\",\"param\":\"ar1\"}]}",
  "{\"name\":\"artists with songs includes All\",\"id\":\"artists\",\"index\":0,\"data\":{\"songs\":[{\"id\":\"t1\",\"title\":\"One\",\"artistName\":\"Artist\"}],\"artists\":[{\"id\":\"ar1\",\"name\":\"Ada\",\"count\":1}]},\"rows\":[{\"id\":\"all-artists\",\"title\":\"All\",\"action\":\"open\",\"screen\":\"songs\",\"screenTitle\":\"All Songs\"},{\"id\":\"ar1\",\"title\":\"Ada\",\"action\":\"open\",\"screen\":\"artist\",\"param\":\"ar1\"}]}",
  "{\"name\":\"songs empty\",\"id\":\"songs\",\"index\":0,\"title\":\"Ignored\",\"rows\":[{\"id\":\"no-music\",\"title\":\"No Music\",\"action\":\"info\",\"centered\":true}]}",
  "{\"name\":\"songs duplicate ids\",\"id\":\"songs\",\"index\":0,\"data\":{\"songs\":[{\"id\":\"t\",\"title\":\"One\",\"artistName\":\"Artist\"},{\"id\":\"t\",\"title\":\"Two\",\"artistName\":\"Artist\"}]},\"rows\":[{\"id\":\"t\",\"title\":\"One\",\"action\":\"play\"},{\"id\":\"t\",\"title\":\"Two\",\"action\":\"play\"}]}",
  "{\"name\":\"playlist unavailable wins over songs\",\"id\":\"playlist\",\"index\":0,\"param\":\"p\",\"data\":{\"playlistDetail\":{\"p\":{\"loaded\":false,\"unavailable\":true}},\"playlistSongs\":{\"p\":[{\"id\":\"t\",\"title\":\"Hidden\",\"artistName\":\"Artist\"}]}},\"rows\":[{\"id\":\"unavailable\",\"title\":\"Unavailable\",\"action\":\"info\",\"centered\":true}]}",
  "{\"name\":\"playlist loading\",\"id\":\"playlist\",\"index\":0,\"param\":\"p\",\"data\":{\"playlistDetail\":{\"p\":{\"loaded\":false,\"unavailable\":false}}},\"rows\":[{\"id\":\"loading\",\"title\":\"Loading…\",\"action\":\"info\",\"centered\":true}]}",
  "{\"name\":\"playlist loaded empty\",\"id\":\"playlist\",\"index\":0,\"param\":\"p\",\"data\":{\"playlistDetail\":{\"p\":{\"loaded\":true,\"unavailable\":false}},\"playlistSongs\":{\"p\":[]}},\"rows\":[{\"id\":\"no-music\",\"title\":\"No Music\",\"action\":\"info\",\"centered\":true}]}",
  "{\"name\":\"playlist missing detail uses songs\",\"id\":\"playlist\",\"index\":0,\"data\":{\"playlistSongs\":{\"\":[{\"id\":\"t\",\"title\":\"Orphan\",\"artistName\":\"Artist\"}]}},\"rows\":[{\"id\":\"t\",\"title\":\"Orphan\",\"action\":\"play\"}]}",
  "{\"name\":\"playlist songs keep duplicate ids\",\"id\":\"playlist\",\"index\":0,\"param\":\"p\",\"title\":\"Mix\",\"data\":{\"playlistDetail\":{\"p\":{\"loaded\":true,\"unavailable\":false}},\"playlistSongs\":{\"p\":[{\"id\":\"a\",\"title\":\"Alpha\",\"artistName\":\"Artist\"},{\"id\":\"a\",\"title\":\"Beta\",\"artistName\":\"Artist\"}]}},\"rows\":[{\"id\":\"a\",\"title\":\"Alpha\",\"action\":\"play\"},{\"id\":\"a\",\"title\":\"Beta\",\"action\":\"play\"}]}",
  "{\"name\":\"artist empty\",\"id\":\"artist\",\"index\":0,\"param\":\"ar\",\"rows\":[{\"id\":\"no-music\",\"title\":\"No Music\",\"action\":\"info\",\"centered\":true}]}",
  "{\"name\":\"artist songs\",\"id\":\"artist\",\"index\":0,\"param\":\"ar\",\"title\":\"Ada\",\"data\":{\"artistSongs\":{\"ar\":[{\"id\":\"t\",\"title\":\"Track\",\"artistName\":\"Artist\"}]}},\"rows\":[{\"id\":\"t\",\"title\":\"Track\",\"action\":\"play\"}]}",
  "{\"name\":\"settings defaults\",\"id\":\"settings\",\"index\":0,\"rows\":[{\"id\":\"about\",\"title\":\"About\",\"action\":\"open\",\"screen\":\"about\"},{\"id\":\"shuffle\",\"title\":\"Shuffle\",\"value\":\"Off\",\"action\":\"cycle\"},{\"id\":\"repeat\",\"title\":\"Repeat\",\"value\":\"Off\",\"action\":\"cycle\"},{\"id\":\"backlight\",\"title\":\"Backlight Timer\",\"action\":\"open\",\"screen\":\"backlight\"},{\"id\":\"clicker\",\"title\":\"Clicker\",\"value\":\"On\",\"action\":\"cycle\"},{\"id\":\"reset\",\"title\":\"Reset All Settings\",\"action\":\"open\",\"screen\":\"reset\"},{\"id\":\"spotify\",\"title\":\"Spotify\",\"action\":\"open\",\"screen\":\"spotify\"}]}",
  "{\"name\":\"settings cycled labels\",\"id\":\"settings\",\"index\":0,\"settings\":{\"shuffle\":\"songs\",\"repeat\":\"one\",\"clicker\":\"off\"},\"rows\":[{\"id\":\"about\",\"title\":\"About\",\"action\":\"open\",\"screen\":\"about\"},{\"id\":\"shuffle\",\"title\":\"Shuffle\",\"value\":\"Songs\",\"action\":\"cycle\"},{\"id\":\"repeat\",\"title\":\"Repeat\",\"value\":\"One\",\"action\":\"cycle\"},{\"id\":\"backlight\",\"title\":\"Backlight Timer\",\"action\":\"open\",\"screen\":\"backlight\"},{\"id\":\"clicker\",\"title\":\"Clicker\",\"value\":\"Off\",\"action\":\"cycle\"},{\"id\":\"reset\",\"title\":\"Reset All Settings\",\"action\":\"open\",\"screen\":\"reset\"},{\"id\":\"spotify\",\"title\":\"Spotify\",\"action\":\"open\",\"screen\":\"spotify\"}]}",
  "{\"name\":\"settings repeat all\",\"id\":\"settings\",\"index\":0,\"settings\":{\"repeat\":\"all\"},\"rows\":[{\"id\":\"about\",\"title\":\"About\",\"action\":\"open\",\"screen\":\"about\"},{\"id\":\"shuffle\",\"title\":\"Shuffle\",\"value\":\"Off\",\"action\":\"cycle\"},{\"id\":\"repeat\",\"title\":\"Repeat\",\"value\":\"All\",\"action\":\"cycle\"},{\"id\":\"backlight\",\"title\":\"Backlight Timer\",\"action\":\"open\",\"screen\":\"backlight\"},{\"id\":\"clicker\",\"title\":\"Clicker\",\"value\":\"On\",\"action\":\"cycle\"},{\"id\":\"reset\",\"title\":\"Reset All Settings\",\"action\":\"open\",\"screen\":\"reset\"},{\"id\":\"spotify\",\"title\":\"Spotify\",\"action\":\"open\",\"screen\":\"spotify\"}]}",
  "{\"name\":\"spotify setup\",\"id\":\"spotify\",\"index\":0,\"data\":{\"connection\":{\"status\":\"setup\",\"account\":null,\"error\":null,\"sourceLabel\":\"Spotify\",\"counts\":{\"playlists\":0,\"artists\":0,\"songs\":0},\"redirectCopied\":false}},\"rows\":[{\"id\":\"spotify-status\",\"title\":\"Status\",\"value\":\"Setup required\",\"action\":\"info\"},{\"id\":\"spotify-source\",\"title\":\"Source\",\"value\":\"Spotify\",\"action\":\"info\"},{\"id\":\"spotify-account\",\"title\":\"Account\",\"value\":\"—\",\"action\":\"info\"},{\"id\":\"spotify-copy-redirect\",\"title\":\"Copy Redirect URI\",\"value\":\"\\u0000undefined\",\"action\":\"spotify-copy-redirect\"},{\"id\":\"spotify-create-app\",\"title\":\"Create personal app\",\"action\":\"spotify-create-app\"},{\"id\":\"spotify-docs\",\"title\":\"Connection docs\",\"action\":\"spotify-docs\"},{\"id\":\"spotify-client-id\",\"title\":\"Client ID\",\"value\":\"Not set\",\"action\":\"spotify-client-id\"},{\"id\":\"spotify-connect\",\"title\":\"Connect\",\"action\":\"spotify-connect\"}]}",
  "{\"name\":\"spotify connecting\",\"id\":\"spotify\",\"index\":0,\"data\":{\"connection\":{\"status\":\"connecting\",\"account\":null,\"error\":null,\"sourceLabel\":\"Spotify\",\"counts\":{\"playlists\":0,\"artists\":0,\"songs\":0},\"redirectCopied\":false}},\"rows\":[{\"id\":\"spotify-status\",\"title\":\"Status\",\"value\":\"Connecting…\",\"action\":\"info\"},{\"id\":\"spotify-source\",\"title\":\"Source\",\"value\":\"Spotify\",\"action\":\"info\"},{\"id\":\"spotify-account\",\"title\":\"Account\",\"value\":\"—\",\"action\":\"info\"},{\"id\":\"spotify-copy-redirect\",\"title\":\"Copy Redirect URI\",\"value\":\"\\u0000undefined\",\"action\":\"spotify-copy-redirect\"},{\"id\":\"spotify-create-app\",\"title\":\"Create personal app\",\"action\":\"spotify-create-app\"},{\"id\":\"spotify-docs\",\"title\":\"Connection docs\",\"action\":\"spotify-docs\"},{\"id\":\"spotify-client-id\",\"title\":\"Client ID\",\"value\":\"Saved\",\"action\":\"spotify-client-id\"},{\"id\":\"spotify-connect\",\"title\":\"Connect\",\"action\":\"spotify-connect\"}]}",
  "{\"name\":\"spotify connected copied redirect\",\"id\":\"spotify\",\"index\":0,\"data\":{\"connection\":{\"status\":\"connected\",\"account\":\"ada\",\"error\":null,\"sourceLabel\":\"Spotify\",\"counts\":{\"playlists\":0,\"artists\":0,\"songs\":0},\"redirectCopied\":true}},\"rows\":[{\"id\":\"spotify-status\",\"title\":\"Status\",\"value\":\"Connected\",\"action\":\"info\"},{\"id\":\"spotify-source\",\"title\":\"Source\",\"value\":\"Spotify\",\"action\":\"info\"},{\"id\":\"spotify-account\",\"title\":\"Account\",\"value\":\"ada\",\"action\":\"info\"},{\"id\":\"spotify-copy-redirect\",\"title\":\"Copy Redirect URI\",\"value\":\"Copied\",\"action\":\"spotify-copy-redirect\"},{\"id\":\"spotify-create-app\",\"title\":\"Create personal app\",\"action\":\"spotify-create-app\"},{\"id\":\"spotify-docs\",\"title\":\"Connection docs\",\"action\":\"spotify-docs\"},{\"id\":\"spotify-client-id\",\"title\":\"Client ID\",\"value\":\"Saved\",\"action\":\"spotify-client-id\"},{\"id\":\"spotify-refresh\",\"title\":\"Refresh Library\",\"action\":\"spotify-refresh\"},{\"id\":\"spotify-disconnect\",\"title\":\"Disconnect\",\"action\":\"spotify-disconnect\"}]}",
  "{\"name\":\"spotify connected with error\",\"id\":\"spotify\",\"index\":0,\"data\":{\"connection\":{\"status\":\"connected\",\"account\":\"ada\",\"error\":\"Rate limited\",\"sourceLabel\":\"Spotify\",\"counts\":{\"playlists\":0,\"artists\":0,\"songs\":0},\"redirectCopied\":false}},\"rows\":[{\"id\":\"spotify-status\",\"title\":\"Status\",\"value\":\"Connected\",\"action\":\"info\"},{\"id\":\"spotify-source\",\"title\":\"Source\",\"value\":\"Spotify\",\"action\":\"info\"},{\"id\":\"spotify-account\",\"title\":\"Account\",\"value\":\"ada\",\"action\":\"info\"},{\"id\":\"spotify-copy-redirect\",\"title\":\"Copy Redirect URI\",\"value\":\"\\u0000undefined\",\"action\":\"spotify-copy-redirect\"},{\"id\":\"spotify-create-app\",\"title\":\"Create personal app\",\"action\":\"spotify-create-app\"},{\"id\":\"spotify-docs\",\"title\":\"Connection docs\",\"action\":\"spotify-docs\"},{\"id\":\"spotify-client-id\",\"title\":\"Client ID\",\"value\":\"Saved\",\"action\":\"spotify-client-id\"},{\"id\":\"spotify-refresh\",\"title\":\"Refresh Library\",\"action\":\"spotify-refresh\"},{\"id\":\"spotify-disconnect\",\"title\":\"Disconnect\",\"action\":\"spotify-disconnect\"},{\"id\":\"spotify-error\",\"title\":\"Error\",\"value\":\"Rate limited\",\"action\":\"info\"}]}",
  "{\"name\":\"spotify error status\",\"id\":\"spotify\",\"index\":0,\"data\":{\"connection\":{\"status\":\"error\",\"account\":null,\"error\":\"Denied\",\"sourceLabel\":\"Spotify\",\"counts\":{\"playlists\":0,\"artists\":0,\"songs\":0},\"redirectCopied\":false}},\"rows\":[{\"id\":\"spotify-status\",\"title\":\"Status\",\"value\":\"Error\",\"action\":\"info\"},{\"id\":\"spotify-source\",\"title\":\"Source\",\"value\":\"Spotify\",\"action\":\"info\"},{\"id\":\"spotify-account\",\"title\":\"Account\",\"value\":\"—\",\"action\":\"info\"},{\"id\":\"spotify-copy-redirect\",\"title\":\"Copy Redirect URI\",\"value\":\"\\u0000undefined\",\"action\":\"spotify-copy-redirect\"},{\"id\":\"spotify-create-app\",\"title\":\"Create personal app\",\"action\":\"spotify-create-app\"},{\"id\":\"spotify-docs\",\"title\":\"Connection docs\",\"action\":\"spotify-docs\"},{\"id\":\"spotify-client-id\",\"title\":\"Client ID\",\"value\":\"Saved\",\"action\":\"spotify-client-id\"},{\"id\":\"spotify-connect\",\"title\":\"Connect\",\"action\":\"spotify-connect\"},{\"id\":\"spotify-error\",\"title\":\"Error\",\"value\":\"Denied\",\"action\":\"info\"}]}",
  "{\"name\":\"spotify disconnected blank error\",\"id\":\"spotify\",\"index\":0,\"data\":{\"connection\":{\"status\":\"disconnected\",\"account\":null,\"error\":\"\",\"sourceLabel\":\"Spotify\",\"counts\":{\"playlists\":0,\"artists\":0,\"songs\":0},\"redirectCopied\":false}},\"rows\":[{\"id\":\"spotify-status\",\"title\":\"Status\",\"value\":\"Not connected\",\"action\":\"info\"},{\"id\":\"spotify-source\",\"title\":\"Source\",\"value\":\"Spotify\",\"action\":\"info\"},{\"id\":\"spotify-account\",\"title\":\"Account\",\"value\":\"—\",\"action\":\"info\"},{\"id\":\"spotify-copy-redirect\",\"title\":\"Copy Redirect URI\",\"value\":\"\\u0000undefined\",\"action\":\"spotify-copy-redirect\"},{\"id\":\"spotify-create-app\",\"title\":\"Create personal app\",\"action\":\"spotify-create-app\"},{\"id\":\"spotify-docs\",\"title\":\"Connection docs\",\"action\":\"spotify-docs\"},{\"id\":\"spotify-client-id\",\"title\":\"Client ID\",\"value\":\"Saved\",\"action\":\"spotify-client-id\"},{\"id\":\"spotify-connect\",\"title\":\"Connect\",\"action\":\"spotify-connect\"}]}",
  "{\"name\":\"about formats counts\",\"id\":\"about\",\"index\":0,\"data\":{\"connection\":{\"status\":\"setup\",\"account\":null,\"error\":null,\"sourceLabel\":\"Spotify\",\"counts\":{\"playlists\":3,\"artists\":4,\"songs\":12345},\"redirectCopied\":false}},\"rows\":[{\"id\":\"name\",\"title\":\"iPod\",\"action\":\"info\",\"centered\":true},{\"id\":\"songs\",\"title\":\"Songs\",\"value\":\"12,345\",\"action\":\"info\"},{\"id\":\"capacity\",\"title\":\"Capacity\",\"value\":\"9.2 GB\",\"action\":\"info\"},{\"id\":\"available\",\"title\":\"Available\",\"value\":\"4.5 GB\",\"action\":\"info\"},{\"id\":\"version\",\"title\":\"Version\",\"value\":\"2644.1.0\",\"action\":\"info\"}]}",
  "{\"name\":\"about zero\",\"id\":\"about\",\"index\":0,\"rows\":[{\"id\":\"name\",\"title\":\"iPod\",\"action\":\"info\",\"centered\":true},{\"id\":\"songs\",\"title\":\"Songs\",\"value\":\"0\",\"action\":\"info\"},{\"id\":\"capacity\",\"title\":\"Capacity\",\"value\":\"9.2 GB\",\"action\":\"info\"},{\"id\":\"available\",\"title\":\"Available\",\"value\":\"4.5 GB\",\"action\":\"info\"},{\"id\":\"version\",\"title\":\"Version\",\"value\":\"2644.1.0\",\"action\":\"info\"}]}",
  "{\"name\":\"backlight options\",\"id\":\"backlight\",\"index\":0,\"rows\":[{\"id\":\"off\",\"title\":\"Off\",\"action\":\"choose\"},{\"id\":\"1sec\",\"title\":\"1 second\",\"action\":\"choose\"},{\"id\":\"2sec\",\"title\":\"2 seconds\",\"action\":\"choose\"},{\"id\":\"3sec\",\"title\":\"3 seconds\",\"action\":\"choose\"},{\"id\":\"5sec\",\"title\":\"5 seconds\",\"action\":\"choose\"},{\"id\":\"always_on\",\"title\":\"Always On\",\"action\":\"choose\"}]}",
  "{\"name\":\"reset options\",\"id\":\"reset\",\"index\":0,\"rows\":[{\"id\":\"cancel\",\"title\":\"Cancel\",\"action\":\"cancel\"},{\"id\":\"reset-all\",\"title\":\"Reset\",\"action\":\"reset\"}]}",
  "{\"name\":\"now playing has no rows\",\"id\":\"now-playing\",\"index\":0,\"rows\":[]}",
  "{\"name\":\"brick has no rows\",\"id\":\"brick\",\"index\":0,\"data\":{\"nowPlaying\":{\"title\":\"X\",\"artistName\":\"Y\"}},\"rows\":[]}",
].map((line) => revive(JSON.parse(line)) as Fixture);

function menuData(patch: Partial<MenuData> | undefined): MenuData {
  if (!patch) return EMPTY_MENU_DATA;
  return {
    ...EMPTY_MENU_DATA,
    ...patch,
    connection: { ...EMPTY_MENU_DATA.connection, ...patch.connection },
  };
}

for (const fixture of FIXTURES) {
  test(fixture.name, () => {
    const settings = { ...defaultSettings(), ...fixture.settings };
    const frame: Frame = { id: fixture.id, index: fixture.index };
    if (fixture.param !== undefined) frame.param = fixture.param;
    if (fixture.title !== undefined) frame.title = fixture.title;
    const actual = fixture.omitData
      ? rows(frame, settings)
      : rows(frame, settings, menuData(fixture.data));
    assert.deepEqual(actual, fixture.rows);
  });
}

test("menus.ts re-exports the split modules", () => {
  assert.equal(barrelRows, rows);
  const titles: Record<ScreenId, string> = {
    main: "iPod",
    playlists: "Playlists",
    artists: "Artists",
    songs: "Songs",
    playlist: "Playlist",
    artist: "Artist",
    settings: "Settings",
    about: "About",
    backlight: "Backlight Timer",
    reset: "Reset All Settings",
    spotify: "Spotify",
    "now-playing": "Now Playing",
    brick: "Brick",
  };
  for (const id of Object.keys(titles) as ScreenId[]) {
    assert.equal(titleFor({ id, index: 0 }), titles[id]);
  }
  assert.equal(titleFor({ id: "songs", index: 2, title: "All Songs" }), "All Songs");
  assert.equal(titleFor({ id: "playlist", index: 1, title: "Mix" }), "Mix");
  assert.equal(titleFor({ id: "artist", index: 1, title: "Ada" }), "Ada");
});
