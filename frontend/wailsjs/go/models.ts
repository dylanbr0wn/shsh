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
	    groupId?: string;
	    color?: string;
	    tags?: string[];
	
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
	        this.groupId = source["groupId"];
	        this.color = source["color"];
	        this.tags = source["tags"];
	    }
	}
	export class Group {
	    id: string;
	    name: string;
	    sortOrder: number;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Group(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.sortOrder = source["sortOrder"];
	        this.createdAt = source["createdAt"];
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
	    }
	}
	export class UpdateGroupInput {
	    id: string;
	    name: string;
	    sortOrder: number;
	
	    static createFrom(source: any = {}) {
	        return new UpdateGroupInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.sortOrder = source["sortOrder"];
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
	    groupId?: string;
	    color?: string;
	    tags?: string[];
	
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
	        this.groupId = source["groupId"];
	        this.color = source["color"];
	        this.tags = source["tags"];
	    }
	}

}

