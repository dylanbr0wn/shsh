export namespace main {
	
	export class CreateHostInput {
	    label: string;
	    hostname: string;
	    port: number;
	    username: string;
	    authMethod: string;
	    password?: string;
	
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
	export class SSHConfigEntry {
	    alias: string;
	    hostname: string;
	    port: number;
	    user: string;
	
	    static createFrom(source: any = {}) {
	        return new SSHConfigEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.alias = source["alias"];
	        this.hostname = source["hostname"];
	        this.port = source["port"];
	        this.user = source["user"];
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
	    }
	}

}

