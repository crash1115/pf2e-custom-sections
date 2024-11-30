import { libWrapper } from "./libwrapper-shim.js";

const MODULE_NAME = "pf2e-custom-sections";


Hooks.once("ready", () => {
   libWrapper.register(
        MODULE_NAME,
        `CONFIG.Actor.sheetClasses.character['pf2e.CharacterSheetPF2e'].cls.prototype.getData`,
        addCustomSectionsToData,
        "WRAPPER"
    );
});

Hooks.on(`renderFeatSheetPF2e`, (app, html, data) => {    
    addCustomSectionField(app, html, data);
});

Hooks.on(`renderAbilitySheetPF2e`, (app, html, data) => {    
    addCustomSectionField(app, html, data);
});


async function addCustomSectionsToData(wrapped, options){
    const data = (await wrapped(options));
    const actor = (await game.actors.get(data.actor._id));
    let newActionsData = JSON.parse(JSON.stringify(data.actions)); //we want a copy, to be safe here
 
    // Handle Encounter Actions
    const actionData = splitActions(data.actions.encounter.action.actions, actor);
    const reactionData = splitActions(data.actions.encounter.reaction.actions, actor);
    const freeData = splitActions(data.actions.encounter.free.actions, actor);
    const encounterActionsWithCustomSections = [...actionData.withCustomSections, ...reactionData.withCustomSections, ... freeData.withCustomSections];
    newActionsData.encounter.action.actions = actionData.withoutCustomSections;
    newActionsData.encounter.reaction.actions = reactionData.withoutCustomSections;
    newActionsData.encounter.free.actions = freeData.withoutCustomSections;
    
    const newEncounterSections = createSectionData(encounterActionsWithCustomSections, actor);
    for(var i = 0; i < newEncounterSections.length; i++){
        const sectionName = newEncounterSections[i].label;
        const sectionId = MODULE_NAME + '-' + slugify(sectionName);
        newActionsData.encounter[sectionId] = newEncounterSections[i];
    }

    data.actions = newActionsData;
    return data;
}

function splitActions(actionsToSplit, actor){
    const actionsWithCustomSections = actionsToSplit.filter( action => {
        const itemId = action.id;
        const item = actor.items.get(itemId);
        const sectionName = item.getFlag(MODULE_NAME, 'customSection');
        if(sectionName) return action;
    });
    
    const actionsWithoutCustomSections = actionsToSplit.filter( action => !actionsWithCustomSections.includes(action) );
    
    return {
        withCustomSections: actionsWithCustomSections,
        withoutCustomSections: actionsWithoutCustomSections
    };
}

function createSectionData (actions, actor){
    let sections = [];
    for (var i=0; i<  actions.length; i++){
        const action =  actions[i];         
        const itemId = action.id;
        const item = actor.items.get(itemId);
        const sectionName = item.getFlag(MODULE_NAME, 'customSection');

        // If the section doesn't already exist, create it
        let sectionIndex = sections.findIndex(s => s.label === sectionName);          
        if(sectionIndex === -1){
            sections.push({ label: sectionName, actions:[] });
            sectionIndex = sections.length - 1;
        }

        // Add the action to the section
        sections[sectionIndex].actions.push(action) ;      
    }
    return sections;
}

/////////////////////////////////
// ITEM SHEET MODIFICATIONS
/////////////////////////////////

async function addCustomSectionField(app, html, data) {
    // Don't activate this if the item is a downtime or exploration activity or an item
    const excludedTraits = ['exploration', 'downtime'];
    const itemTraits = data.data.traits.value || [];
    const dontOverride = itemTraits.some( t => excludedTraits.includes(t) );
    if(dontOverride) return;

    let sidebar = html.find('.inventory-details');
    let sectionInput = $(await renderTemplate('modules/pf2e-custom-sections/templates/feat-sheet-input.hbs', data.item.flags[MODULE_NAME]))
    sidebar.append(sectionInput);
    activateTabListeners(html, data);   
}

function activateTabListeners(html, data){
    const item = data.item;
    html.find('#pf2e-custom-sections-name').change(async (ev) => {
        const newSectionName = ev.target.value;
        if(newSectionName){
            await item.setFlag(MODULE_NAME, "customSection", newSectionName);
        } else {
            await item.unsetFlag(MODULE_NAME, "customSection");
        }
        
    }); 
}

/////////////////////////////////
// UTILITY
/////////////////////////////////

function slugify(str) {
    str = str.replace(/^\s+|\s+$/g, ''); // trim leading/trailing white space
    str = str.toLowerCase(); // convert string to lowercase
    str = str.replace(/[^a-z0-9 -]/g, '') // remove any non-alphanumeric characters
             .replace(/\s+/g, '-') // replace spaces with hyphens
             .replace(/-+/g, '-'); // remove consecutive hyphens
    return str;
}