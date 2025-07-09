import { NgModule } from "@angular/core";
import { CoreModule } from "../../core/core.module";
import { RouterModule, Routes } from "@angular/router";
import { ConnectorsComponent } from "./connectors.component";
import { SolidConnectorComponent } from "./solid-connector/solid-connector.component";
import { SolidConnectorService } from "./solid-connector/solid-connector.service";

const routes: Routes = [
  {
    path: "",
    component: ConnectorsComponent
  }
];

@NgModule({
  imports: [CoreModule, RouterModule.forChild(routes)],
  declarations: [ConnectorsComponent, SolidConnectorComponent],
  providers: [SolidConnectorService]
})
export class ConnectorsModule {}
