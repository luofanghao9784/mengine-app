package com.dreamcore.workspace;

import com.dreamcore.workspace.collection.CollectionDeployment;
import com.dreamcore.workspace.collection.NativeGovernanceDeployment;
import com.dreamcore.workspace.conversation.BriefingBootstrapDeployment;
import com.dreamcore.workspace.conversation.ReconciliationDeployment;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.PlatformBootstrap;
import java.sql.SQLException;
import java.util.Arrays;
import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

@SpringBootApplication
public class WorkspaceApplication {
   public static void main(String[] args) {
      if (Arrays.asList(args).contains("--bootstrap-admin")) {
         SpringApplication application = new SpringApplication(new Class[]{WorkspaceApplication.class});
         application.setWebApplicationType(WebApplicationType.NONE);

         try {
            ConfigurableApplicationContext context = application.run(args);

            try {
               ((PlatformBootstrap)context.getBean(PlatformBootstrap.class)).run();
               System.out.println("Platform bootstrap completed.");
            } catch (Throwable var16) {
               if (context != null) {
                  try {
                     context.close();
                  } catch (Throwable var7) {
                     var16.addSuppressed(var7);
                  }
               }

               throw var16;
            }

            if (context != null) {
               context.close();
            }
         } catch (Exception failure) {
            System.err.println("Platform bootstrap failed; check configuration or existing administrator.");
            System.exit(1);
         }
      } else if (Arrays.asList(args).contains("--native-governance")) {
         SpringApplication application = new SpringApplication(new Class[]{WorkspaceApplication.class});
         application.setWebApplicationType(WebApplicationType.NONE);
         application.addInitializers(new ApplicationContextInitializer[]{context -> context.addBeanFactoryPostProcessor(factory -> {
            if (factory instanceof BeanDefinitionRegistry registry) {
               String processor = "org.springframework.context.annotation.internalScheduledAnnotationProcessor";
               if (registry.containsBeanDefinition(processor)) {
                  registry.removeBeanDefinition(processor);
               }
            }
         })});

         try {
            ConfigurableApplicationContext context = application.run(args);

            try {
               ((NativeGovernanceDeployment)context.getBean(NativeGovernanceDeployment.class)).run();
               System.out.println("Governance operation completed; inspect private receipt.");
            } catch (Throwable var14) {
               if (context != null) {
                  try {
                     context.close();
                  } catch (Throwable var6) {
                     var14.addSuppressed(var6);
                  }
               }

               throw var14;
            }

            if (context != null) {
               context.close();
            }
         } catch (Exception failure) {
            System.err.println("Governance operation rejected; verify scope and current basis.");
            System.exit(1);
         }
      } else if (Arrays.asList(args).contains("--provision-collection")) {
         SpringApplication application = new SpringApplication(new Class[]{WorkspaceApplication.class});
         application.setWebApplicationType(WebApplicationType.NONE);

         try {
            ConfigurableApplicationContext context = application.run(args);

            try {
               ((CollectionDeployment)context.getBean(CollectionDeployment.class)).run();
               System.out.println("Collection deployment metadata applied.");
            } catch (Throwable var12) {
               if (context != null) {
                  try {
                     context.close();
                  } catch (Throwable var5) {
                     var12.addSuppressed(var5);
                  }
               }

               throw var12;
            }

            if (context != null) {
               context.close();
            }
         } catch (Exception failure) {
            System.err.println("Collection deployment failed; verify the manifest, enterprise scope and host configuration.");
            System.exit(1);
         }
      } else if (Arrays.asList(args).contains("--bootstrap-briefings")) {
         SpringApplication application = new SpringApplication(new Class[]{WorkspaceApplication.class});
         application.setWebApplicationType(WebApplicationType.NONE);

         try {
            ConfigurableApplicationContext context = application.run(args);

            try {
               ((BriefingBootstrapDeployment)context.getBean(BriefingBootstrapDeployment.class)).run();
               System.out.println("External briefing validation completed; inspect the private receipt.");
            } catch (Throwable var10) {
               if (context != null) {
                  try {
                     context.close();
                  } catch (Throwable var9) {
                     var10.addSuppressed(var9);
                  }
               }

               throw var10;
            }

            if (context != null) {
               context.close();
            }
         } catch (Exception failure) {
            System.err
               .println(
                  "External briefing deployment failed; no partial batch is published. "
                     + (failure instanceof IdentityException e ? e.code : failure.getClass().getSimpleName())
               );
            Throwable cause = failure;

            while (cause.getCause() != null) {
               cause = cause.getCause();
            }

            if (cause instanceof SQLException sql) {
               System.err.println("Database validation code: " + sql.getSQLState());
            }

            System.exit(1);
         }
      } else if (Arrays.asList(args).contains("--run-reconciliation-task")) {
         SpringApplication application = new SpringApplication(new Class[]{WorkspaceApplication.class});
         application.setWebApplicationType(WebApplicationType.NONE);

         try {
            ConfigurableApplicationContext context = application.run(args);

            try {
               ((ReconciliationDeployment)context.getBean(ReconciliationDeployment.class)).run();
               System.out.println("Local task completed; inspect private receipt.");
            } catch (Throwable var18) {
               if (context != null) {
                  try {
                     context.close();
                  } catch (Throwable var8) {
                     var18.addSuppressed(var8);
                  }
               }

               throw var18;
            }

            if (context != null) {
               context.close();
            }
         } catch (Exception failure) {
            System.err.println("Local task rejected: " + (failure instanceof IdentityException e ? e.code : failure.getClass().getSimpleName()));
            System.exit(1);
         }
      } else {
         SpringApplication.run(WorkspaceApplication.class, args);
      }
   }
}
