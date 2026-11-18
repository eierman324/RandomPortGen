// Port-Datenbank: bekannte Dienste und von Browsern gesperrte Ports.

// Ports, die Chrome/Firefox nicht aufrufen ("ERR_UNSAFE_PORT").
globalThis.BROWSER_BLOCKED = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104,
  109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
  526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

// Häufig benutzte Ports – die meidet der Generator standardmäßig.
globalThis.KNOWN_PORTS = {
  20: "FTP (Daten)", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS", 67: "DHCP", 69: "TFTP",
  80: "HTTP", 110: "POP3", 123: "NTP", 135: "Windows RPC", 137: "NetBIOS", 139: "NetBIOS / SMB", 143: "IMAP",
  161: "SNMP", 389: "LDAP", 443: "HTTPS", 445: "SMB", 465: "SMTPS", 514: "Syslog", 587: "SMTP Submission",
  636: "LDAPS", 993: "IMAPS", 995: "POP3S", 1080: "SOCKS-Proxy", 1194: "OpenVPN", 1433: "Microsoft SQL Server",
  1521: "Oracle DB", 1883: "MQTT", 1900: "SSDP / UPnP", 2049: "NFS", 2181: "ZooKeeper", 2375: "Docker API",
  2376: "Docker API (TLS)", 2379: "etcd", 3000: "React / Next.js / Grafana / Rails", 3001: "Dev-Server (Ausweichport)",
  3005: "Dev-Server", 3306: "MySQL / MariaDB", 3389: "Remote Desktop (RDP)", 3478: "STUN / TURN", 4000: "Jekyll / Phoenix",
  4200: "Angular CLI", 4321: "Astro", 4318: "OpenTelemetry (HTTP)", 4317: "OpenTelemetry (gRPC)", 4369: "Erlang EPMD",
  4443: "HTTPS (alternativ)", 5000: "Flask / macOS AirPlay", 5001: "Flask (Ausweichport)", 5037: "Android ADB",
  5173: "Vite", 5174: "Vite (Ausweichport)", 5222: "XMPP", 5353: "mDNS", 5432: "PostgreSQL", 5500: "VS Code Live Server",
  5601: "Kibana", 5672: "RabbitMQ", 5900: "VNC", 5984: "CouchDB", 6006: "Storybook / TensorBoard", 6379: "Redis",
  6443: "Kubernetes API", 7000: "Cassandra / macOS AirPlay", 7474: "Neo4j", 7687: "Neo4j Bolt", 8000: "Django / Python http.server",
  8008: "HTTP (alternativ)", 8080: "HTTP-Proxy / Tomcat / Jenkins", 8081: "HTTP (alternativ) / Metro", 8086: "InfluxDB",
  8088: "HTTP (alternativ)", 8096: "Jellyfin", 8123: "Home Assistant / ClickHouse", 8200: "Vault", 8443: "HTTPS (alternativ)",
  8500: "Consul", 8787: "RStudio Server", 8883: "MQTT (TLS)", 8888: "Jupyter Notebook", 9000: "PHP-FPM / SonarQube / MinIO",
  9001: "MinIO Console", 9042: "Cassandra (CQL)", 9090: "Prometheus", 9092: "Kafka", 9100: "Node Exporter / Drucker",
  9200: "Elasticsearch", 9229: "Node.js Debugger", 9300: "Elasticsearch (Cluster)", 9418: "Git", 9443: "Portainer",
  10000: "Webmin", 11211: "Memcached", 11434: "Ollama", 15672: "RabbitMQ Management", 19006: "Expo Web",
  19000: "Expo", 25565: "Minecraft", 27017: "MongoDB", 27018: "MongoDB (Shard)", 32400: "Plex",
  51820: "WireGuard", 54321: "Supabase", 50000: "SAP / Jenkins Agent",
};

globalThis.IANA_RANGES = [
  { min: 0, max: 1023, name: "System Ports (Well-known)", note: "Für Standarddienste reserviert, unter Linux nur mit root-Rechten nutzbar." },
  { min: 1024, max: 49151, name: "Registered Ports", note: "Der übliche Bereich für eigene Dienste." },
  { min: 49152, max: 65535, name: "Dynamic / Ephemeral Ports", note: "Das Betriebssystem nutzt diese Ports für ausgehende Verbindungen." },
];

globalThis.PRESETS = {
  safe: { min: 1024, max: 32767, label: "Sicher", hint: "1024–32767 · keine Überschneidung mit den Ephemeral-Bereichen von Windows, macOS und Linux" },
  registered: { min: 1024, max: 49151, label: "Registriert", hint: "1024–49151 · der komplette IANA-Bereich für eigene Dienste" },
  dynamic: { min: 49152, max: 65535, label: "Dynamisch", hint: "49152–65535 · kann mit ausgehenden Verbindungen kollidieren" },
  custom: { min: null, max: null, label: "Eigener", hint: "Eigener Bereich" },
};
