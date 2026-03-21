export namespace main {
	
	export class BulkConnectResult {
	    sessionId: string;
	    hostId: string;
	
	    static createFrom(source: any = {}) {
	        return new BulkConnectResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.hostId = source["hostId"];
	    }
	}
	export class GenerateKeyInput {
	    keyType: string;
	    rsaBits: number;
	    savePath: string;
	    passphrase: string;
	    comment: string;
	
	    static createFrom(source: any = {}) {
	        return new GenerateKeyInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.keyType = source["keyType"];
	        this.rsaBits = source["rsaBits"];
	        this.savePath = source["savePath"];
	        this.passphrase = source["passphrase"];
	        this.comment = source["comment"];
	    }
	}
	export class GenerateKeyResult {
	    privateKeyPath: string;
	    publicKeyPath: string;
	    publicKeyText: string;
	
	    static createFrom(source: any = {}) {
	        return new GenerateKeyResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.privateKeyPath = source["privateKeyPath"];
	        this.publicKeyPath = source["publicKeyPath"];
	        this.publicKeyText = source["publicKeyText"];
	    }
	}
	export class LogFileInfo {
	    path: string;
	    filename: string;
	    hostLabel: string;
	    createdAt: string;
	    sizeBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new LogFileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.filename = source["filename"];
	        this.hostLabel = source["hostLabel"];
	        this.createdAt = source["createdAt"];
	        this.sizeBytes = source["sizeBytes"];
	    }
	}
	export class PingResult {
	    hostId: string;
	    latencyMs: number;
	
	    static createFrom(source: any = {}) {
	        return new PingResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostId = source["hostId"];
	        this.latencyMs = source["latencyMs"];
	    }
	}
	export class QuickConnectInput {
	    hostname: string;
	    port: number;
	    username: string;
	    password?: string;
	    authMethod: string;
	
	    static createFrom(source: any = {}) {
	        return new QuickConnectInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostname = source["hostname"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.authMethod = source["authMethod"];
	    }
	}

}

export namespace session {
	
	export class PortForwardInfo {
	    id: string;
	    localPort: number;
	    remoteHost: string;
	    remotePort: number;
	
	    static createFrom(source: any = {}) {
	        return new PortForwardInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.localPort = source["localPort"];
	        this.remoteHost = source["remoteHost"];
	        this.remotePort = source["remotePort"];
	    }
	}
	export class SFTPEntry {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    modTime: string;
	    mode: string;
	
	    static createFrom(source: any = {}) {
	        return new SFTPEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.mode = source["mode"];
	    }
	}

}

export namespace sshconfig {
	
	export class Entry {
	    alias: string;
	    hostname: string;
	    port: number;
	    user: string;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.alias = source["alias"];
	        this.hostname = source["hostname"];
	        this.port = source["port"];
	        this.user = source["user"];
	    }
	}

}

export namespace store {
	
	export class CreateGroupInput {
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateGroupInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	    }
	}
	export class CreateHostInput {
	    label: string;
	    hostname: string;
	    port: number;
	    username: string;
	    authMethod: string;
	    password?: string;
	    keyPath?: string;
	    keyPassphrase?: string;
	    groupId?: string;
	    color?: string;
	    tags?: string[];
	    terminalProfileId?: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateHostInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.hostname = source["hostname"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	        this.password = source["password"];
	        this.keyPath = source["keyPath"];
	        this.keyPassphrase = source["keyPassphrase"];
	        this.groupId = source["groupId"];
	        this.color = source["color"];
	        this.tags = source["tags"];
	        this.terminalProfileId = source["terminalProfileId"];
	    }
	}
	export class CreateProfileInput {
	    name: string;
	    fontSize: number;
	    cursorStyle: string;
	    cursorBlink: boolean;
	    scrollback: number;
	    colorTheme: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateProfileInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.fontSize = source["fontSize"];
	        this.cursorStyle = source["cursorStyle"];
	        this.cursorBlink = source["cursorBlink"];
	        this.scrollback = source["scrollback"];
	        this.colorTheme = source["colorTheme"];
	    }
	}
	export class Group {
	    id: string;
	    name: string;
	    sortOrder: number;
	    createdAt: string;
	    terminalProfileId?: string;
	
	    static createFrom(source: any = {}) {
	        return new Group(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.sortOrder = source["sortOrder"];
	        this.createdAt = source["createdAt"];
	        this.terminalProfileId = source["terminalProfileId"];
	    }
	}
	export class Host {
	    id: string;
	    label: string;
	    hostname: string;
	    port: number;
	    username: string;
	    authMethod: string;
	    createdAt: string;
	    lastConnectedAt?: string;
	    groupId?: string;
	    color?: string;
	    tags?: string[];
	    terminalProfileId?: string;
	    keyPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new Host(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.hostname = source["hostname"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	        this.createdAt = source["createdAt"];
	        this.lastConnectedAt = source["lastConnectedAt"];
	        this.groupId = source["groupId"];
	        this.color = source["color"];
	        this.tags = source["tags"];
	        this.terminalProfileId = source["terminalProfileId"];
	        this.keyPath = source["keyPath"];
	    }
	}
	export class TerminalProfile {
	    id: string;
	    name: string;
	    fontSize: number;
	    cursorStyle: string;
	    cursorBlink: boolean;
	    scrollback: number;
	    colorTheme: string;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new TerminalProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.fontSize = source["fontSize"];
	        this.cursorStyle = source["cursorStyle"];
	        this.cursorBlink = source["cursorBlink"];
	        this.scrollback = source["scrollback"];
	        this.colorTheme = source["colorTheme"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class UpdateGroupInput {
	    id: string;
	    name: string;
	    sortOrder: number;
	    terminalProfileId?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateGroupInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.sortOrder = source["sortOrder"];
	        this.terminalProfileId = source["terminalProfileId"];
	    }
	}
	export class UpdateHostInput {
	    id: string;
	    label: string;
	    hostname: string;
	    port: number;
	    username: string;
	    authMethod: string;
	    password?: string;
	    keyPath?: string;
	    keyPassphrase?: string;
	    groupId?: string;
	    color?: string;
	    tags?: string[];
	    terminalProfileId?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateHostInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.hostname = source["hostname"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	        this.password = source["password"];
	        this.keyPath = source["keyPath"];
	        this.keyPassphrase = source["keyPassphrase"];
	        this.groupId = source["groupId"];
	        this.color = source["color"];
	        this.tags = source["tags"];
	        this.terminalProfileId = source["terminalProfileId"];
	    }
	}
	export class UpdateProfileInput {
	    id: string;
	    name: string;
	    fontSize: number;
	    cursorStyle: string;
	    cursorBlink: boolean;
	    scrollback: number;
	    colorTheme: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateProfileInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.fontSize = source["fontSize"];
	        this.cursorStyle = source["cursorStyle"];
	        this.cursorBlink = source["cursorBlink"];
	        this.scrollback = source["scrollback"];
	        this.colorTheme = source["colorTheme"];
	    }
	}

}

