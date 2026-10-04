package com.dreamcore.workspace;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import com.dreamcore.workspace.identity.PlatformBootstrap;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class WorkspaceApplication {
    public static void main(String[] args) {
        if (java.util.Arrays.asList(args).contains("--bootstrap-admin")) {
            var application = new SpringApplication(WorkspaceApplication.class);
            application.setWebApplicationType(WebApplicationType.NONE);
            try (var context = application.run(args)) {
                context.getBean(PlatformBootstrap.class).run();
                System.out.println("Platform bootstrap completed.");
            } catch (Exception failure) {
                // Do not print arguments, secret file content or database exception details.
                System.err.println("Platform bootstrap failed; check configuration or existing administrator.");
                System.exit(1);
            }
        } else if (java.util.Arrays.asList(args).contains("--provision-collection")) {
            var application = new SpringApplication(WorkspaceApplication.class);
            application.setWebApplicationType(WebApplicationType.NONE);
            try (var context = application.run(args)) {
                context.getBean(com.dreamcore.workspace.collection.CollectionDeployment.class).run();
                System.out.println("Collection deployment metadata applied.");
            } catch (Exception failure) {
                System.err.println("Collection deployment failed; verify the manifest, enterprise scope and host configuration.");
                System.exit(1);
            }
        } else {
            SpringApplication.run(WorkspaceApplication.class, args);
        }
    }
}
