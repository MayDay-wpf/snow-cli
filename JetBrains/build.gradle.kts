plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.21"
    id("org.jetbrains.intellij") version "1.16.1"
}

group = "com.snow"
version = "0.4.3"

repositories {
    mavenCentral()
}

// Configure Gradle IntelliJ Plugin
intellij {
    version.set("2023.1.5")
    type.set("IC") // Target IDE Platform (IC = IntelliJ IDEA Community)

    plugins.set(listOf("org.jetbrains.plugins.terminal"))
}

tasks {
    // Set the JVM compatibility versions
    withType<JavaCompile> {
        sourceCompatibility = "17"
        targetCompatibility = "17"
    }

    withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        kotlinOptions.jvmTarget = "17"
    }

    patchPluginXml {
        sinceBuild.set("231")
        untilBuild.set("253.*")
    }

    signPlugin {
        certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
        privateKey.set(System.getenv("PRIVATE_KEY"))
        password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
    }

    publishPlugin {
        token.set(System.getenv("PUBLISH_TOKEN"))
    }

    // Skip instrumentCode task to avoid JDK path issues
    instrumentCode {
        enabled = false
    }

    // Skip buildSearchableOptions to avoid coroutines-javaagent issues
    buildSearchableOptions {
        enabled = false
    }
}

dependencies {
    implementation("org.java-websocket:Java-WebSocket:1.5.4")
    implementation("org.json:json:20231013")
}
